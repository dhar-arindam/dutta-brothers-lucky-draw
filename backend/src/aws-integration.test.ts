import {
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';

import { DynamoDbDrawStore } from './durable-dynamodb-store.js';

class FakeDocClient {
  public readonly calls: unknown[] = [];
  private readonly queue: Array<() => Promise<unknown>> = [];

  public enqueue(handler: () => Promise<unknown>): void {
    this.queue.push(handler);
  }

  public async send(command: unknown): Promise<unknown> {
    this.calls.push(command);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('Unexpected command call.');
    }

    return next();
  }
}

describe('aws integration semantics', () => {
  it('uses atomic DynamoDB transaction for claim write and aggregate updates', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => ({}));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: {
        claimId: '',
        claimTimestamp: '2026-08-16T10:30:00.000Z',
        customerName: 'Arindam Roy',
        phone: '9876543210',
        billNumberDisplay: 'DB12345',
        billNumberNormalized: 'DB12345',
        prize: {
          id: 'prize-001',
          name: 'Electric Kettle',
          displayName: 'Electric Kettle',
        },
      },
    });

    expect(fake.calls[0]).toBeInstanceOf(UpdateCommand);
    expect(fake.calls[1]).toBeInstanceOf(TransactWriteCommand);

    const transaction = fake.calls[1] as TransactWriteCommand;
    expect(transaction.input.TransactItems).toBeDefined();
    expect(transaction.input.TransactItems?.length).toBeGreaterThanOrEqual(5);

    const billGuard = transaction.input.TransactItems?.find((item) => item.Put?.Item?.pk === 'BILL');
    expect(billGuard?.Put?.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
  });

  it('handles duplicate-claim race by returning existing claim without second write', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 2 } }));
    fake.enqueue(async () => {
      throw new Error('Conditional check failed');
    });
    fake.enqueue(async () => ({ Item: { pk: 'BILL', sk: 'DB12345', claimId: 'DB26-000001' } }));
    fake.enqueue(async () => ({
      Item: {
        pk: 'CLAIM',
        sk: 'DB26-000001',
        entityType: 'CLAIM',
        claimId: 'DB26-000001',
        claimTimestamp: '2026-08-16T10:30:00.000Z',
        customerName: 'Arindam Roy',
        phone: '9876543210',
        billNumberDisplay: 'DB12345',
        billNumberNormalized: 'DB12345',
        prize: {
          id: 'prize-001',
          name: 'Electric Kettle',
          displayName: 'Electric Kettle',
        },
        gsi1pk: 'CLAIM',
        gsi1sk: '2026-08-16T10:30:00.000Z#DB26-000001',
      },
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const result = await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: {
        claimId: '',
        claimTimestamp: '2026-08-16T10:30:00.000Z',
        customerName: 'Arindam Roy',
        phone: '9876543210',
        billNumberDisplay: 'DB12345',
        billNumberNormalized: 'DB12345',
        prize: {
          id: 'prize-001',
          name: 'Electric Kettle',
          displayName: 'Electric Kettle',
        },
      },
    });

    expect(result.type).toBe('EXISTS');
    if (result.type !== 'EXISTS') {
      throw new Error('Expected existing-claim response.');
    }

    expect(result.claim.claimId).toBe('DB26-000001');
  });

  it('queries claims through gsi1 and returns continuation token for pagination', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000002',
          entityType: 'CLAIM',
          claimId: 'DB26-000002',
          claimTimestamp: '2026-08-17T10:30:00.000Z',
          customerName: 'Sujata Das',
          phone: '9123456789',
          billNumberDisplay: 'DB2002',
          billNumberNormalized: 'DB2002',
          prize: {
            id: 'prize-001',
            name: 'Electric Kettle',
            displayName: 'Electric Kettle',
          },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-17T10:30:00.000Z#DB26-000002',
        },
      ],
      LastEvaluatedKey: {
        pk: 'CLAIM',
        sk: 'DB26-000002',
        gsi1pk: 'CLAIM',
        gsi1sk: '2026-08-17T10:30:00.000Z#DB26-000002',
      },
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-17T10:30:00.000Z'),
    });

    const result = await store.listAdminClaims({ pageSize: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextPageToken).toBeTypeOf('string');
    expect(fake.calls[0]).toBeInstanceOf(QueryCommand);

    const query = fake.calls[0] as QueryCommand;
    expect(query.input.IndexName).toBe('gsi1');
    expect(query.input.KeyConditionExpression).toContain('gsi1pk = :gsi1pk');
    expect(query.input.ScanIndexForward).toBe(false);
  });

  it('surfaces denied operations from DynamoDB', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => {
      const accessDenied = new Error('AccessDeniedException');
      accessDenied.name = 'AccessDeniedException';
      throw accessDenied;
    });

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    await expect(
      store.createClaimAndUpdateAggregatesAtomic({
        now: new Date('2026-08-16T10:30:00.000Z'),
        claim: {
          claimId: '',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          customerName: 'Arindam Roy',
          phone: '9876543210',
          billNumberDisplay: 'DB12345',
          billNumberNormalized: 'DB12345',
          prize: {
            id: 'prize-001',
            name: 'Electric Kettle',
            displayName: 'Electric Kettle',
          },
        },
      }),
    ).rejects.toMatchObject({ name: 'AccessDeniedException' });
  });
});

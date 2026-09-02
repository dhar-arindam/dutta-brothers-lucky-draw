import {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import { DynamoDbDrawStore } from './durable-dynamodb-store.js';
import { CSV_EXPORT_MAX_ROWS, CsvExportTooLargeError } from './store.js';

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

const makeTransactionCanceledException = (reasonCodes: Array<string | undefined>): Error => {
  const error = new Error('Transaction cancelled');
  Object.assign(error, {
    name: 'TransactionCanceledException',
    CancellationReasons: reasonCodes.map((code) => (code ? { Code: code } : { Code: 'None' })),
  });
  return error;
};

interface StoredEntity {
  pk: string;
  sk: string;
  [key: string]: unknown;
}

// Simulates real DynamoDB behaviour needed to exercise genuine concurrency:
// - the SEQ counter is a plain atomic ADD (never conflicts, matching real DynamoDB UpdateItem semantics)
// - BILL/CLAIM puts enforce uniqueness (ConditionalCheckFailed -> DUPLICATE)
// - all successful claims briefly hold a single shared "AGG lock" (mirroring contention on the
//   shared AGG/TOTAL, AGG/DATE#, AGG/PRIZE# items), so concurrent unique claims genuinely race
//   and some must be classified TRANSIENT and retried, exactly like the real defect being fixed.
class ConcurrencySimulatingDocClient {
  private aggLocked = false;
  private sequence = 0;
  private readonly billItems = new Map<string, StoredEntity>();
  private readonly claimItems = new Map<string, StoredEntity>();
  public transactWriteAttempts = 0;

  public async send(command: unknown): Promise<unknown> {
    if (command instanceof UpdateCommand && (command.input.Key as { pk?: string })?.pk === 'SEQ') {
      this.sequence += 1;
      return { Attributes: { value: this.sequence } };
    }

    if (command instanceof GetCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      if (key.pk === 'BILL') {
        return { Item: this.billItems.get(key.sk) };
      }
      if (key.pk === 'CLAIM') {
        return { Item: this.claimItems.get(key.sk) };
      }
      return {};
    }

    if (command instanceof TransactWriteCommand) {
      this.transactWriteAttempts += 1;
      const items = command.input.TransactItems as unknown as Array<{
        Put?: { Item: StoredEntity };
      }>;
      const billItem = items[0]?.Put?.Item;
      const claimItem = items[1]?.Put?.Item;
      if (!billItem || !claimItem) {
        throw new Error('Unexpected transaction shape in test fake.');
      }

      if (this.billItems.has(billItem.sk) || this.claimItems.has(claimItem.sk)) {
        throw makeTransactionCanceledException([
          'ConditionalCheckFailed',
          'None',
          'None',
          'None',
          'None',
        ]);
      }

      if (this.aggLocked) {
        throw makeTransactionCanceledException([
          'None',
          'None',
          'TransactionConflict',
          'None',
          'None',
        ]);
      }

      this.aggLocked = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      this.billItems.set(billItem.sk, billItem);
      this.claimItems.set(claimItem.sk, claimItem);
      this.aggLocked = false;
      return {};
    }

    return {};
  }
}

describe('dynamo db draw store persistence', () => {
  it('creates claim and updates aggregates atomically', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => ({}));

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

    expect(result.type).toBe('CREATED');
    if (result.type !== 'CREATED') {
      throw new Error('Expected created claim result.');
    }

    expect(result.claim.claimId).toBe('DB26-000001');
    expect(fake.calls[0]).toBeInstanceOf(UpdateCommand);
    expect(fake.calls[1]).toBeInstanceOf(TransactWriteCommand);
  });

  it('returns existing claim when uniqueness transaction fails', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 2 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'ConditionalCheckFailed',
        'None',
        'None',
        'None',
        'None',
      ]);
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
      throw new Error('Expected existing claim result.');
    }

    expect(result.claim.claimId).toBe('DB26-000001');
    expect(fake.calls[2]).toBeInstanceOf(GetCommand);
    expect(fake.calls[3]).toBeInstanceOf(GetCommand);
  });

  it('deletes a claim and decrements aggregates via transaction', async () => {
    const fake = new FakeDocClient();
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
    fake.enqueue(async () => ({}));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const result = await store.deleteClaim('DB26-000001');

    expect(result.type).toBe('SUCCESS');
    expect(fake.calls[0]).toBeInstanceOf(GetCommand);
    expect(fake.calls[1]).toBeInstanceOf(TransactWriteCommand);
  });

  it('returns NOT_FOUND when deleting a claim that does not exist', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({}));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const result = await store.deleteClaim('DB26-999999');

    expect(result.type).toBe('NOT_FOUND');
  });

  it('clears all claims by deleting bill keys before claim keys, then aggregates', async () => {
    const fake = new FakeDocClient();
    // BILL is drained first so an interrupted run leaves bills claimable rather than stranded.
    fake.enqueue(async () => ({
      Items: [{ pk: 'BILL', sk: 'DB12345' }],
    }));
    fake.enqueue(async () => ({}));
    fake.enqueue(async () => ({
      Items: [
        { pk: 'CLAIM', sk: 'DB26-000001' },
        { pk: 'CLAIM', sk: 'DB26-000002' },
      ],
    }));
    fake.enqueue(async () => ({}));
    fake.enqueue(async () => ({
      Items: [{ pk: 'AGG', sk: 'TOTAL' }],
    }));
    fake.enqueue(async () => ({}));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const deletedCount = await store.clearAllClaims();

    expect(deletedCount).toBe(2);
    expect(fake.calls).toHaveLength(6);
    expect(fake.calls[0]).toBeInstanceOf(QueryCommand);
    expect((fake.calls[0] as QueryCommand).input.ExpressionAttributeValues).toEqual({
      ':pk': 'BILL',
    });
    expect(fake.calls[1]).toBeInstanceOf(BatchWriteCommand);
    expect((fake.calls[2] as QueryCommand).input.ExpressionAttributeValues).toEqual({
      ':pk': 'CLAIM',
    });
    expect(fake.calls[3]).toBeInstanceOf(BatchWriteCommand);
    expect((fake.calls[4] as QueryCommand).input.ExpressionAttributeValues).toEqual({
      ':pk': 'AGG',
    });
    expect(fake.calls[5]).toBeInstanceOf(BatchWriteCommand);
  });

  it('resends unprocessed batch delete items instead of reporting a silent partial delete', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Items: [] }));
    fake.enqueue(async () => ({
      Items: [
        { pk: 'CLAIM', sk: 'DB26-000001' },
        { pk: 'CLAIM', sk: 'DB26-000002' },
      ],
    }));
    // DynamoDB reports throttled writes here instead of failing the call.
    fake.enqueue(async () => ({
      UnprocessedItems: {
        'draws-table': [{ DeleteRequest: { Key: { pk: 'CLAIM', sk: 'DB26-000002' } } }],
      },
    }));
    fake.enqueue(async () => ({}));
    fake.enqueue(async () => ({ Items: [] }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep: async () => {},
    });

    const deletedCount = await store.clearAllClaims();

    expect(deletedCount).toBe(2);
    const retried = fake.calls[3] as BatchWriteCommand;
    expect(retried).toBeInstanceOf(BatchWriteCommand);
    expect(retried.input.RequestItems?.['draws-table']).toEqual([
      { DeleteRequest: { Key: { pk: 'CLAIM', sk: 'DB26-000002' } } },
    ]);
  });

  it('fails loudly when unprocessed batch delete items never drain', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Items: [] }));
    fake.enqueue(async () => ({ Items: [{ pk: 'CLAIM', sk: 'DB26-000001' }] }));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      fake.enqueue(async () => ({
        UnprocessedItems: {
          'draws-table': [{ DeleteRequest: { Key: { pk: 'CLAIM', sk: 'DB26-000001' } } }],
        },
      }));
    }

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep: async () => {},
    });

    await expect(store.clearAllClaims()).rejects.toThrow(/could not process 1 item/);
  });

  it('refuses a csv export larger than the row limit rather than exhausting the function', async () => {
    const oversizedPage = Array.from({ length: CSV_EXPORT_MAX_ROWS + 1 }, (_unused, index) => ({
      pk: 'CLAIM',
      sk: `DB26-${index}`,
      claimId: `DB26-${index}`,
      claimTimestamp: '2026-08-16T10:30:00.000Z',
      customerName: 'Amit Das',
      phone: '9123456789',
      billNumberDisplay: `BILL-${index}`,
      billNumberNormalized: `BILL-${index}`,
      prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
    }));

    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Items: oversizedPage }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    await expect(store.listAdminClaimsForCsv(2026)).rejects.toBeInstanceOf(CsvExportTooLargeError);
  });

  it('exports only claims falling in the requested Asia/Kolkata calendar year', async () => {
    const makeClaim = (claimId: string, claimTimestamp: string) => ({
      pk: 'CLAIM',
      sk: claimId,
      claimId,
      claimTimestamp,
      customerName: 'Amit Das',
      phone: '9123456789',
      billNumberDisplay: `BILL-${claimId}`,
      billNumberNormalized: `BILL-${claimId}`,
      prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
    });

    const fake = new FakeDocClient();
    fake.enqueue(async () => ({
      Items: [
        // 19:00 UTC on 31 Dec is already 00:30 on 1 Jan in Asia/Kolkata, so this belongs to 2027.
        makeClaim('DB26-000003', '2026-12-31T19:00:00.000Z'),
        makeClaim('DB26-000002', '2026-06-15T10:30:00.000Z'),
        makeClaim('DB26-000001', '2025-06-15T10:30:00.000Z'),
      ],
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const claims = await store.listAdminClaimsForCsv(2026);

    expect(claims.map((claim) => claim.claimId)).toEqual(['DB26-000002']);
  });

  it('builds summary from aggregate records', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Item: { successfulSpins: 9 } }));
    fake.enqueue(async () => ({ Item: { successfulSpins: 2 } }));
    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'AGG',
          sk: 'PRIZE#prize-001',
          prizeId: 'prize-001',
          prizeName: 'Electric Kettle',
          successfulSpins: 4,
        },
      ],
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const summary = await store.summary();

    expect(summary.totalSuccessfulSpins).toBe(9);
    expect(summary.today.successfulSpins).toBe(2);
    expect(summary.prizeDistribution).toEqual([
      {
        prizeId: 'prize-001',
        prizeName: 'Electric Kettle',
        givenCount: 4,
      },
    ]);

    expect(fake.calls[2]).toBeInstanceOf(QueryCommand);
  });

  it('validates addPrize input and supports list/update prize flows', async () => {
    const fake = new FakeDocClient();
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const invalid = await store.addPrize({ name: ' ', weight: 0, active: true });
    expect(invalid.type).toBe('VALIDATION_ERROR');

    fake.enqueue(async () => ({ Attributes: { value: 9 } }));
    fake.enqueue(async () => ({}));
    const created = await store.addPrize({ name: 'Air Fryer', weight: 3, active: true });
    expect(created.type).toBe('SUCCESS');

    fake.enqueue(async () => ({ Items: [] }));
    const noPrize = await store.updatePrize('prize-999', { weight: 5 });
    expect(noPrize.type).toBe('NOT_FOUND');

    fake.enqueue(async () => ({
      Item: {
        pk: 'PRIZE',
        sk: 'prize-009',
        entityType: 'PRIZE',
        id: 'prize-009',
        name: 'Air Fryer',
        displayName: 'Air Fryer',
        weight: 3,
        active: true,
        createdAt: '2026-08-16T10:30:00.000Z',
        updatedAt: '2026-08-16T10:30:00.000Z',
      },
    }));
    const missingFields = await store.updatePrize('prize-009', {});
    expect(missingFields.type).toBe('VALIDATION_ERROR');
  });

  it('lists eligible prizes and filters admin claims with pagination token', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'PRIZE',
          sk: 'prize-001',
          entityType: 'PRIZE',
          id: 'prize-001',
          name: 'Kettle',
          displayName: 'Kettle',
          weight: 1,
          active: true,
          createdAt: '2026-08-16T10:30:00.000Z',
          updatedAt: '2026-08-16T10:30:00.000Z',
        },
        {
          pk: 'PRIZE',
          sk: 'prize-002',
          entityType: 'PRIZE',
          id: 'prize-002',
          name: 'Inactive',
          displayName: 'Inactive',
          weight: 2,
          active: false,
          createdAt: '2026-08-16T10:30:00.000Z',
          updatedAt: '2026-08-16T10:30:00.000Z',
        },
      ],
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const eligible = await store.listEligiblePrizesForDraw();
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.id).toBe('prize-001');

    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000001',
          entityType: 'CLAIM',
          claimId: 'DB26-000001',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          customerName: 'Amit Das',
          phone: '9876543210',
          billNumberDisplay: 'AB1',
          billNumberNormalized: 'AB1',
          prize: { id: 'prize-001', name: 'Kettle', displayName: 'Kettle' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-16T10:30:00.000Z#DB26-000001',
        },
      ],
      LastEvaluatedKey: { pk: 'CLAIM', sk: 'DB26-000001' },
    }));

    const firstPage = await store.listAdminClaims({ pageSize: 1, search: 'Amit' });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextPageToken).not.toBeNull();

    fake.enqueue(async () => ({ Items: [] }));
    const secondPage = firstPage.nextPageToken
      ? await store.listAdminClaims({ pageSize: 1, pageToken: firstPage.nextPageToken })
      : await store.listAdminClaims({ pageSize: 1 });
    expect(secondPage.items).toEqual([]);
  });

  it('keeps filtered pages newest-first without skipping matches between DynamoDB batches', async () => {
    const fake = new FakeDocClient();
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000002',
          entityType: 'CLAIM',
          claimId: 'DB26-000002',
          claimTimestamp: '2026-08-17T10:30:00.000Z',
          customerName: 'Riya Sen',
          phone: '9876543210',
          billNumberDisplay: 'XY100',
          billNumberNormalized: 'XY100',
          prize: { id: 'prize-001', name: 'Kettle', displayName: 'Kettle' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-17T10:30:00.000Z#DB26-000002',
        },
      ],
      LastEvaluatedKey: { pk: 'CLAIM', sk: 'DB26-000002' },
    }));

    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000001',
          entityType: 'CLAIM',
          claimId: 'DB26-000001',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          customerName: 'Amit Das',
          phone: '9876543210',
          billNumberDisplay: 'AB1',
          billNumberNormalized: 'AB1',
          prize: { id: 'prize-001', name: 'Kettle', displayName: 'Kettle' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-16T10:30:00.000Z#DB26-000001',
        },
      ],
    }));

    const firstPage = await store.listAdminClaims({ pageSize: 1, search: 'Amit' });

    expect(firstPage.items[0]?.claimId).toBe('DB26-000001');
    expect(firstPage.nextPageToken).toBeNull();
    expect((fake.calls[0] as QueryCommand).input.Limit).toBe(1);
    expect((fake.calls[0] as QueryCommand).input.ScanIndexForward).toBe(false);
  });

  it('gets and updates campaign with fallback defaults and validation', async () => {
    const fake = new FakeDocClient();
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-12-01T00:00:00.000Z'),
    });

    fake.enqueue(async () => ({ Item: undefined }));
    const fallbackCampaign = await store.getCampaign();
    expect(fallbackCampaign.status).toBe('ENDED');

    fake.enqueue(async () => ({ Item: undefined }));
    const invalid = await store.updateCampaign({ fromDate: '2026-14-01' });
    expect(invalid.type).toBe('VALIDATION_ERROR');

    fake.enqueue(async () => ({ Item: undefined }));
    fake.enqueue(async () => ({}));
    const updated = await store.updateCampaign({ fromDate: '2026-11-01', toDate: '2026-12-31' });
    expect(updated.type).toBe('SUCCESS');
  });

  it('throws when create transaction fails and no existing claim can be loaded', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 11 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'ConditionalCheckFailed',
        'None',
        'None',
        'None',
        'None',
      ]);
    });
    fake.enqueue(async () => ({ Item: undefined }));

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
          billNumberDisplay: 'BILL-404',
          billNumberNormalized: 'BILL-404',
          prize: {
            id: 'prize-001',
            name: 'Electric Kettle',
            displayName: 'Electric Kettle',
          },
        },
      }),
    ).rejects.toThrow('Unable to persist claim transaction.');
  });

  it('supports legacy campaign timestamp shape and returns ENDED when out of range', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({
      Item: {
        pk: 'CAMPAIGN',
        sk: 'CONFIG',
        entityType: 'CAMPAIGN',
        id: 'festive-2026',
        timezone: 'Asia/Kolkata',
        startAt: '2026-08-01T00:00:00.000Z',
        endAt: '2026-08-16T00:00:00.000Z',
      },
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-17T00:00:00.000Z'),
    });

    const campaign = await store.getCampaign();
    expect(campaign.fromDate).toBe('2026-08-01');
    expect(campaign.toDate).toBe('2026-08-16');
    expect(campaign.status).toBe('ENDED');
  });

  it('filters claims by date/prize/search and ignores malformed page token', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000001',
          entityType: 'CLAIM',
          claimId: 'DB26-000001',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          customerName: 'Amit Das',
          phone: '9876543210',
          billNumberDisplay: 'AB1',
          billNumberNormalized: 'AB1',
          prize: { id: 'prize-001', name: 'Kettle', displayName: 'Kettle' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-16T10:30:00.000Z#DB26-000001',
        },
        {
          pk: 'CLAIM',
          sk: 'DB26-000002',
          entityType: 'CLAIM',
          claimId: 'DB26-000002',
          claimTimestamp: '2026-08-17T10:30:00.000Z',
          customerName: 'Riya Sen',
          phone: '9999999999',
          billNumberDisplay: 'CD2',
          billNumberNormalized: 'CD2',
          prize: { id: 'prize-002', name: 'Coffee', displayName: 'Coffee' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-17T10:30:00.000Z#DB26-000002',
        },
      ],
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const response = await store.listAdminClaims({
      pageSize: 10,
      pageToken: 'not-base64',
      from: '2026-08-16T00:00:00.000Z',
      to: '2026-08-16T23:59:59.999Z',
      prizeId: 'prize-001',
      search: 'AB',
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.claimId).toBe('DB26-000001');
    expect(response.items[0]?.maskedPhone).toBe('*****3210');

    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000002',
          entityType: 'CLAIM',
          claimId: 'DB26-000002',
          claimTimestamp: '2026-08-17T10:30:00.000Z',
          customerName: 'Riya Sen',
          phone: '9999999999',
          billNumberDisplay: 'CD2',
          billNumberNormalized: 'CD2',
          prize: { id: 'prize-002', name: 'Coffee', displayName: 'Coffee' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-17T10:30:00.000Z#DB26-000002',
        },
      ],
    }));

    const patternResponse = await store.listAdminClaims({ pageSize: 10, search: 'iya' });
    expect(patternResponse.items[0]?.claimId).toBe('DB26-000002');
  });

  it('throws when PRIZE sequence is invalid', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 0 } }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    await expect(store.addPrize({ name: 'Air Fryer', weight: 5, active: true })).rejects.toThrow(
      'Invalid PRIZE sequence value.',
    );
  });

  it('covers prizeId mismatch and prize-name search branches in claim filtering', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000010',
          entityType: 'CLAIM',
          claimId: 'DB26-000010',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          customerName: 'User One',
          phone: '9876543210',
          billNumberDisplay: 'B10',
          billNumberNormalized: 'B10',
          prize: { id: 'prize-010', name: 'Mixer Grinder', displayName: 'Mixer Grinder' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-16T10:30:00.000Z#DB26-000010',
        },
      ],
    }));

    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const prizeMismatch = await store.listAdminClaims({ pageSize: 10, prizeId: 'prize-999' });
    expect(prizeMismatch.items).toEqual([]);

    fake.enqueue(async () => ({
      Items: [
        {
          pk: 'CLAIM',
          sk: 'DB26-000011',
          entityType: 'CLAIM',
          claimId: 'DB26-000011',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          customerName: 'User Two',
          phone: '9123456789',
          billNumberDisplay: 'B11',
          billNumberNormalized: 'B11',
          prize: { id: 'prize-011', name: 'Coffee Maker', displayName: 'Coffee Maker' },
          gsi1pk: 'CLAIM',
          gsi1sk: '2026-08-16T10:30:00.000Z#DB26-000011',
        },
      ],
    }));

    const searchByPrizeName = await store.listAdminClaims({ pageSize: 10, search: 'coffee' });
    expect(searchByPrizeName.items).toHaveLength(1);
    expect(searchByPrizeName.items[0]?.claimId).toBe('DB26-000011');
  });

  it('validates prize name max-length and active type branches', async () => {
    const fake = new FakeDocClient();
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
    });

    const tooLongName = await store.addPrize({
      name: 'A'.repeat(101),
      weight: 5,
      active: true,
    });
    expect(tooLongName.type).toBe('VALIDATION_ERROR');

    const invalidActive = await store.addPrize({
      name: 'Valid Name',
      weight: 5,
      active: 'yes' as never,
    });
    expect(invalidActive.type).toBe('VALIDATION_ERROR');
  });
});

describe('dynamo db draw store transient transaction contention retry', () => {
  const baseClaim = {
    claimId: '',
    claimTimestamp: '2026-08-16T10:30:00.000Z',
    customerName: 'Arindam Roy',
    phone: '9876543210',
    billNumberDisplay: 'DB12345',
    billNumberNormalized: 'DB12345',
    prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
  };

  it('succeeds on the first attempt without retrying when there is no contention', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => ({}));

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
    });

    const result = await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: baseClaim,
    });

    expect(result.type).toBe('CREATED');
    expect(sleep).not.toHaveBeenCalled();
    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(1);
  });

  it('retries once after a single TransactionConflict and then succeeds', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'TransactionConflict',
        'None',
        'None',
      ]);
    });
    fake.enqueue(async () => ({}));

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
      random: () => 0.5,
    });

    const result = await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: baseClaim,
    });

    expect(result.type).toBe('CREATED');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(2);
  });

  it('retries multiple times through repeated transient failures before succeeding', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'TransactionConflict',
        'None',
        'None',
      ]);
    });
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'None',
        'ProvisionedThroughputExceeded',
        'None',
      ]);
    });
    fake.enqueue(async () => {
      throw makeTransactionCanceledException(['None', 'None', 'None', 'None', 'ThrottlingError']);
    });
    fake.enqueue(async () => ({}));

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
      random: () => 0.5,
      maxTransactionAttempts: 4,
    });

    const result = await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: baseClaim,
    });

    expect(result.type).toBe('CREATED');
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(4);
  });

  it('exhausts retries and throws after repeated transient contention beyond the max attempts', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'TransactionConflict',
        'None',
        'None',
      ]);
    });
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'TransactionConflict',
        'None',
        'None',
      ]);
    });
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'TransactionConflict',
        'None',
        'None',
      ]);
    });

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
      random: () => 0.5,
      maxTransactionAttempts: 3,
    });

    await expect(
      store.createClaimAndUpdateAggregatesAtomic({
        now: new Date('2026-08-16T10:30:00.000Z'),
        claim: baseClaim,
      }),
    ).rejects.toThrow();

    // Exactly maxTransactionAttempts sends, and retries only between attempts (maxAttempts - 1 sleeps).
    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('detects a genuine duplicate bill via ConditionalCheckFailed and returns EXISTS without retrying', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'ConditionalCheckFailed',
        'None',
        'None',
        'None',
        'None',
      ]);
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
        prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
      },
    }));

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
    });

    const result = await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: baseClaim,
    });

    expect(result.type).toBe('EXISTS');
    expect(sleep).not.toHaveBeenCalled();
    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(1);
  });

  it('does not mistake a duplicate bill for transient contention even when maxTransactionAttempts > 1', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'ConditionalCheckFailed',
        'None',
        'None',
        'None',
        'None',
      ]);
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
        prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
      },
    }));

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
      maxTransactionAttempts: 5,
    });

    await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: baseClaim,
    });

    // Only one TransactWriteCommand was ever sent -- duplicate detection short-circuits immediately, never retries.
    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws immediately on an unexpected permanent DynamoDB error without retrying', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw new Error('AccessDeniedException: user is not authorized');
    });

    const sleep = vi.fn(async () => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep,
      maxTransactionAttempts: 5,
    });

    await expect(
      store.createClaimAndUpdateAggregatesAtomic({
        now: new Date('2026-08-16T10:30:00.000Z'),
        claim: baseClaim,
      }),
    ).rejects.toThrow('AccessDeniedException');

    expect(fake.calls.filter((call) => call instanceof TransactWriteCommand)).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('logs safe diagnostic information without leaking customer PII on retry', async () => {
    const fake = new FakeDocClient();
    fake.enqueue(async () => ({ Attributes: { value: 1 } }));
    fake.enqueue(async () => {
      throw makeTransactionCanceledException([
        'None',
        'None',
        'TransactionConflict',
        'None',
        'None',
      ]);
    });
    fake.enqueue(async () => ({}));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-16T10:30:00.000Z'),
      sleep: async () => {},
      random: () => 0.5,
    });

    await store.createClaimAndUpdateAggregatesAtomic({
      now: new Date('2026-08-16T10:30:00.000Z'),
      claim: baseClaim,
      correlationId: 'req-123',
    });

    const loggedPayloads = logSpy.mock.calls.map((call) => String(call[0]));
    expect(loggedPayloads.some((payload) => payload.includes('TRANSIENT_CONTENTION_RETRY'))).toBe(
      true,
    );
    expect(loggedPayloads.some((payload) => payload.includes('req-123'))).toBe(true);
    for (const payload of loggedPayloads) {
      expect(payload).not.toContain(baseClaim.phone);
      expect(payload).not.toContain(baseClaim.customerName);
    }

    logSpy.mockRestore();
  });
});

describe('dynamo db draw store concurrency (10 unique participants, real interleaving)', () => {
  it('accepts all 10 concurrent unique claims with 0 contention-caused failures', async () => {
    const fake = new ConcurrencySimulatingDocClient();
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-21T10:00:00.000Z'),
      retryBaseDelayMs: 2,
      retryMaxDelayMs: 20,
      random: () => 0.5,
      maxTransactionAttempts: 100,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        store.createClaimAndUpdateAggregatesAtomic({
          now: new Date('2026-08-21T10:00:00.000Z'),
          claim: {
            claimId: '',
            claimTimestamp: '2026-08-21T10:00:00.000Z',
            customerName: `Perf Test User ${index}`,
            phone: `9000000${String(index).padStart(3, '0')}`,
            billNumberDisplay: `CONC-${index}`,
            billNumberNormalized: `CONC-${index}`,
            prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
          },
        }),
      ),
    );

    const created = results.filter((result) => result.type === 'CREATED');
    expect(created).toHaveLength(10);

    const uniqueClaimIds = new Set(
      created.map((result) => (result.type === 'CREATED' ? result.claim.claimId : '')),
    );
    expect(uniqueClaimIds.size).toBe(10);

    expect(fake.transactWriteAttempts).toBeGreaterThanOrEqual(10);
  });

  it('accepts exactly one claim when 10 concurrent requests use the SAME bill number', async () => {
    const fake = new ConcurrencySimulatingDocClient();
    const store = new DynamoDbDrawStore(fake as never, {
      tableName: 'draws-table',
      now: () => new Date('2026-08-21T10:00:00.000Z'),
      retryBaseDelayMs: 2,
      retryMaxDelayMs: 20,
      random: () => 0.5,
      maxTransactionAttempts: 100,
    });

    const sameClaimInput = {
      claimId: '',
      claimTimestamp: '2026-08-21T10:00:00.000Z',
      customerName: 'Same Participant',
      phone: '9000000999',
      billNumberDisplay: 'DUP-BILL',
      billNumberNormalized: 'DUP-BILL',
      prize: { id: 'prize-001', name: 'Electric Kettle', displayName: 'Electric Kettle' },
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.createClaimAndUpdateAggregatesAtomic({
          now: new Date('2026-08-21T10:00:00.000Z'),
          claim: sameClaimInput,
        }),
      ),
    );

    const created = results.filter((result) => result.type === 'CREATED');
    const exists = results.filter((result) => result.type === 'EXISTS');
    expect(created).toHaveLength(1);
    expect(exists).toHaveLength(9);

    const uniqueClaimIds = new Set(results.map((result) => result.claim.claimId));
    expect(uniqueClaimIds.size).toBe(1);
  });
});

import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
      throw new Error('Expected existing claim result.');
    }

    expect(result.claim.claimId).toBe('DB26-000001');
    expect(fake.calls[2]).toBeInstanceOf(GetCommand);
    expect(fake.calls[3]).toBeInstanceOf(GetCommand);
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
      throw new Error('Conditional check failed');
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

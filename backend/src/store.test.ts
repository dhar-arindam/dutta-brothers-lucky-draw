import { describe, expect, it } from 'vitest';

import type { Claim } from './domain.js';
import { InMemoryDrawStore } from './store.js';

const now = new Date('2026-08-16T10:30:00.000Z');

const createClaim = (overrides?: Partial<Claim>): Claim => {
  return {
    claimId: 'DB26-000001',
    claimTimestamp: '2026-08-16T10:30:00.000Z',
    customerName: 'Amit Das',
    phone: '9876543210',
    billNumberDisplay: 'AB123',
    billNumberNormalized: 'AB123',
    prize: {
      id: 'prize-001',
      name: 'Electric Kettle',
      displayName: 'Electric Kettle',
    },
    ...overrides,
  };
};

describe('in-memory store claim atomicity and duplicate protection', () => {
  it('creates first claim and returns existing on duplicate bill without incrementing totals', () => {
    const store = new InMemoryDrawStore({ now: () => now });

    const first = store.createClaimAndUpdateAggregatesAtomic({
      claim: createClaim(),
      now,
    });

    const duplicate = store.createClaimAndUpdateAggregatesAtomic({
      claim: createClaim({ claimId: 'DB26-000999' }),
      now,
    });

    expect(first.type).toBe('CREATED');
    expect(duplicate.type).toBe('EXISTS');
    expect(store.snapshot().claimCount).toBe(1);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);
  });
});

describe('in-memory store admin claims query and pagination', () => {
  it('supports search, prize, date filtering and pagination token handling', () => {
    const store = new InMemoryDrawStore({ now: () => now });

    const claims = [
      createClaim(),
      createClaim({
        claimId: 'DB26-000002',
        claimTimestamp: '2026-08-16T11:30:00.000Z',
        customerName: 'Riya Sen',
        billNumberDisplay: 'XY100',
        billNumberNormalized: 'XY100',
        prize: { id: 'prize-002', name: 'Coffee Maker', displayName: 'Coffee Maker' },
      }),
      createClaim({
        claimId: 'DB26-000003',
        claimTimestamp: '2026-08-17T09:30:00.000Z',
        customerName: 'Rahul Pal',
        billNumberDisplay: 'ZZ200',
        billNumberNormalized: 'ZZ200',
      }),
    ];

    for (const claim of claims) {
      store.createClaimAndUpdateAggregatesAtomic({ claim, now: new Date(claim.claimTimestamp) });
    }

    const filtered = store.listAdminClaims({
      pageSize: 1,
      prizeId: 'prize-002',
      from: '2026-08-16T00:00:00.000Z',
      to: '2026-08-16T23:59:59.999Z',
      search: 'Riya',
    });

    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.claimId).toBe('DB26-000002');

    const patternMatch = store.listAdminClaims({ pageSize: 10, search: 'iya' });
    expect(patternMatch.items.map((item) => item.claimId)).toContain('DB26-000002');

    const firstPage = store.listAdminClaims({ pageSize: 1 });
    const secondPage = firstPage.nextPageToken
      ? store.listAdminClaims({ pageSize: 1, pageToken: firstPage.nextPageToken })
      : store.listAdminClaims({ pageSize: 1 });
    const fallbackTokenPage = store.listAdminClaims({ pageSize: 1, pageToken: 'invalid-token' });

    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect(fallbackTokenPage.items[0]?.claimId).toBe(firstPage.items[0]?.claimId);
  });
});

describe('in-memory store campaign and prize admin operations', () => {
  it('validates campaign updates and marks ended campaign status', () => {
    const store = new InMemoryDrawStore({
      now: () => new Date('2026-12-01T00:00:00.000Z'),
      initialCampaign: {
        id: 'festive-2026',
        timezone: 'Asia/Kolkata',
        fromDate: '2026-08-01',
        toDate: '2026-11-01',
      },
    });

    const invalid = store.updateCampaign({ fromDate: '2026-13-40' });
    expect(invalid.type).toBe('VALIDATION_ERROR');

    const reversed = store.updateCampaign({ fromDate: '2026-11-10', toDate: '2026-11-01' });
    expect(reversed.type).toBe('VALIDATION_ERROR');

    const valid = store.updateCampaign({ fromDate: '2026-11-01', toDate: '2026-12-31' });
    expect(valid.type).toBe('SUCCESS');

    const campaign = store.getCampaign();
    expect(campaign.status).toBe('ACTIVE');
    expect(campaign.fromDate).toBe('2026-11-01');
  });

  it('handles prize add/update transitions and summary distribution', () => {
    const store = new InMemoryDrawStore({ now: () => now });

    const invalidAdd = store.addPrize({ name: ' ', weight: 0, active: true });
    expect(invalidAdd.type).toBe('VALIDATION_ERROR');

    const created = store.addPrize({ name: 'Air Fryer', weight: 5, active: true });
    expect(created.type).toBe('SUCCESS');
    if (created.type !== 'SUCCESS') {
      throw new Error('Expected successful prize creation.');
    }

    const notFound = store.updatePrize('prize-999', { weight: 2 });
    expect(notFound.type).toBe('NOT_FOUND');

    const missingFields = store.updatePrize(created.prize.id, {});
    expect(missingFields.type).toBe('VALIDATION_ERROR');

    const updated = store.updatePrize(created.prize.id, { active: false, weight: 3 });
    expect(updated.type).toBe('SUCCESS');

    const claim = createClaim({
      claimId: 'DB26-000050',
      billNumberDisplay: 'AB050',
      billNumberNormalized: 'AB050',
      prize: { id: created.prize.id, name: created.prize.name, displayName: created.prize.displayName },
    });
    store.createClaimAndUpdateAggregatesAtomic({ claim, now });

    const summary = store.summary();
    const distribution = summary.prizeDistribution.find((item) => item.prizeId === created.prize.id);

    expect(distribution?.givenCount).toBe(1);
    expect(store.listEligiblePrizesForDraw().some((item) => item.id === created.prize.id)).toBe(false);
  });
});

describe('in-memory store claim deletion', () => {
  it('deletes a claim, decrements aggregates, and frees the bill number for reuse', () => {
    const store = new InMemoryDrawStore({ now: () => now });

    store.createClaimAndUpdateAggregatesAtomic({ claim: createClaim(), now });
    expect(store.snapshot().claimCount).toBe(1);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);

    const result = store.deleteClaim('DB26-000001');
    expect(result.type).toBe('SUCCESS');
    expect(store.snapshot().claimCount).toBe(0);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(0);
    expect(store.snapshot().aggregate.byPrizeId['prize-001']).toBeUndefined();

    const reused = store.createClaimAndUpdateAggregatesAtomic({
      claim: createClaim({ claimId: 'DB26-000002' }),
      now,
    });
    expect(reused.type).toBe('CREATED');
  });

  it('returns NOT_FOUND when deleting an unknown claim', () => {
    const store = new InMemoryDrawStore({ now: () => now });

    const result = store.deleteClaim('DB26-999999');
    expect(result.type).toBe('NOT_FOUND');
  });

  it('clears all claims and resets aggregates to zero', () => {
    const store = new InMemoryDrawStore({ now: () => now });

    store.createClaimAndUpdateAggregatesAtomic({ claim: createClaim(), now });
    store.createClaimAndUpdateAggregatesAtomic({
      claim: createClaim({ claimId: 'DB26-000002', billNumberDisplay: 'AB124', billNumberNormalized: 'AB124' }),
      now,
    });

    const deletedCount = store.clearAllClaims();

    expect(deletedCount).toBe(2);
    expect(store.snapshot().claimCount).toBe(0);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(0);
    expect(Object.keys(store.snapshot().aggregate.byPrizeId)).toHaveLength(0);
    expect(Object.keys(store.snapshot().aggregate.byDate)).toHaveLength(0);
  });
});

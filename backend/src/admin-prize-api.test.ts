import { describe, expect, it } from 'vitest';

import { createAdminPrizeApiHandler, createDrawApiHandler } from './app.js';
import { ClaimIdGenerator } from './claim-id.js';
import type { Campaign } from './domain.js';
import { DrawService } from './draw-service.js';
import { CsvExportTooLargeError, InMemoryDrawStore } from './store.js';

const now = new Date('2026-08-16T10:30:00.000Z');

const campaign: Campaign = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-11-01T18:29:59.000Z',
};

const createHarness = () => {
  const store = new InMemoryDrawStore({
    initialPrizes: [
      {
        id: 'prize-001',
        name: 'Electric Kettle',
        displayName: 'Electric Kettle',
        weight: 1,
        active: true,
      },
      {
        id: 'prize-002',
        name: 'Coffee Maker',
        displayName: 'Coffee Maker',
        weight: 4,
        active: false,
      },
    ],
    now: () => now,
  });

  const drawService = new DrawService({
    campaign,
    claimIdGenerator: new ClaimIdGenerator(),
    store,
    random: () => 0,
    now: () => now,
  });

  return {
    store,
    drawApiHandler: createDrawApiHandler(drawService),
    adminApiHandler: createAdminPrizeApiHandler(store),
  };
};

describe('admin prize listing', () => {
  it('returns all configured prizes including active and inactive', () => {
    const { adminApiHandler } = createHarness();

    const response = adminApiHandler.listPrizes();

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: 'SUCCESS',
      items: [
        { id: 'prize-001', active: true },
        { id: 'prize-002', active: false },
      ],
    });
  });
});

describe('add prize', () => {
  it('adds valid prize and includes it in future eligible set when active and positive-weight', () => {
    const { adminApiHandler, store } = createHarness();

    const response = adminApiHandler.addPrize(
      JSON.stringify({
        name: 'Mixer Grinder',
        weight: 6,
        active: true,
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      status: 'SUCCESS',
      item: {
        name: 'Mixer Grinder',
        weight: 6,
        active: true,
      },
    });

    const eligible = store.listEligiblePrizesForDraw();
    expect(eligible.map((item) => item.name)).toContain('Mixer Grinder');
  });

  it('rejects invalid prize payload', () => {
    const { adminApiHandler } = createHarness();

    const response = adminApiHandler.addPrize(
      JSON.stringify({
        name: '',
        weight: 2,
        active: true,
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects invalid weight configuration', () => {
    const { adminApiHandler } = createHarness();

    const response = adminApiHandler.addPrize(
      JSON.stringify({
        name: 'Invalid Weight Prize',
        weight: 0,
        active: true,
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        weight: 'Weight must be a positive number.',
      },
    });
  });
});

describe('weight and activation updates', () => {
  it('updates weight with valid value', () => {
    const { adminApiHandler } = createHarness();

    const response = adminApiHandler.updatePrize('prize-001', JSON.stringify({ weight: 9 }));

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: 'SUCCESS',
      item: {
        id: 'prize-001',
        weight: 9,
      },
    });
  });

  it('rejects invalid weight update', () => {
    const { adminApiHandler } = createHarness();

    const response = adminApiHandler.updatePrize('prize-001', JSON.stringify({ weight: -1 }));

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });
  });

  it('deactivates and reactivates prize for future eligibility', () => {
    const { adminApiHandler, store } = createHarness();

    const deactivated = adminApiHandler.updatePrize('prize-001', JSON.stringify({ active: false }));

    expect(deactivated.statusCode).toBe(200);
    expect(store.listEligiblePrizesForDraw().map((item) => item.id)).not.toContain('prize-001');

    const reactivated = adminApiHandler.updatePrize('prize-001', JSON.stringify({ active: true }));

    expect(reactivated.statusCode).toBe(200);
    expect(store.listEligiblePrizesForDraw().map((item) => item.id)).toContain('prize-001');
  });

  it('preserves claim snapshot after weight, active-state, and new-prize changes', () => {
    const { drawApiHandler, adminApiHandler, store } = createHarness();

    const drawResponse = drawApiHandler.handle(
      JSON.stringify({
        name: 'Arindam',
        phone: '9876543210',
        billNumber: 'DB9001',
      }),
    );

    expect(drawResponse.statusCode).toBe(201);
    if (drawResponse.body.status !== 'SUCCESS') {
      throw new Error('Expected a successful claim.');
    }

    const claimId = drawResponse.body.claimId;

    const weightUpdate = adminApiHandler.updatePrize('prize-001', JSON.stringify({ weight: 12 }));
    const activeUpdate = adminApiHandler.updatePrize(
      'prize-001',
      JSON.stringify({ active: false }),
    );
    const addPrize = adminApiHandler.addPrize(
      JSON.stringify({
        name: 'Air Fryer',
        weight: 5,
        active: true,
      }),
    );

    expect(weightUpdate.statusCode).toBe(200);
    expect(activeUpdate.statusCode).toBe(200);
    expect(addPrize.statusCode).toBe(201);

    const storedClaim = store.getClaimById(claimId);
    expect(storedClaim?.prize).toMatchObject({
      id: 'prize-001',
      name: 'Electric Kettle',
      displayName: 'Electric Kettle',
    });
  });

  it('applies concurrent admin updates without partial corruption', async () => {
    const { adminApiHandler } = createHarness();

    const [a, b] = await Promise.all([
      Promise.resolve(adminApiHandler.updatePrize('prize-001', JSON.stringify({ weight: 7 }))),
      Promise.resolve(adminApiHandler.updatePrize('prize-001', JSON.stringify({ weight: 9 }))),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const finalState = adminApiHandler.listPrizes();
    expect(finalState.statusCode).toBe(200);
    if (finalState.body.status !== 'SUCCESS') {
      throw new Error('Expected successful list response.');
    }

    if (!('items' in finalState.body)) {
      throw new Error('Expected list response with items.');
    }

    const updated = finalState.body.items.find((item) => 'id' in item && item.id === 'prize-001');
    expect(updated).toBeDefined();
    if (!updated || !('weight' in updated)) {
      throw new Error('Expected updated admin prize entry.');
    }

    expect([7, 9]).toContain(updated.weight);
  });
});

describe('campaign, summary, and claims endpoints', () => {
  it('returns summary with aggregate counters', () => {
    const { drawApiHandler, adminApiHandler } = createHarness();

    drawApiHandler.handle(
      JSON.stringify({
        name: 'Arindam',
        phone: '9876543210',
        billNumber: 'DB-SUMMARY-1',
      }),
    );

    const response = adminApiHandler.getSummary();
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: 'SUCCESS',
      totalSuccessfulSpins: 1,
    });
  });

  it('gets campaign and updates campaign with validation', () => {
    const { adminApiHandler } = createHarness();

    const initial = adminApiHandler.getCampaign();
    expect(initial.statusCode).toBe(200);
    expect(initial.body).toMatchObject({
      status: 'SUCCESS',
      campaign: {
        status: 'ACTIVE',
      },
    });

    const invalid = adminApiHandler.updateCampaign(JSON.stringify({ fromDate: '2026-13-01' }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });

    const valid = adminApiHandler.updateCampaign(
      JSON.stringify({ fromDate: '2026-09-01', toDate: '2026-12-01' }),
    );
    expect(valid.statusCode).toBe(200);
    expect(valid.body).toMatchObject({
      status: 'SUCCESS',
      campaign: {
        fromDate: '2026-09-01',
        toDate: '2026-12-01',
      },
    });
  });

  it('validates and filters claims listing query', () => {
    const { drawApiHandler, adminApiHandler } = createHarness();

    drawApiHandler.handle(
      JSON.stringify({
        name: 'Amit Das',
        phone: '9999999999',
        billNumber: 'CLAIM-001',
      }),
    );

    const invalid = adminApiHandler.listClaims(new URLSearchParams({ pageSize: '151' }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        pageSize: 'Page size must be an integer between 1 and 150.',
      },
    });

    const valid = adminApiHandler.listClaims(
      new URLSearchParams({
        search: 'Amit',
        from: '2026-08-16T00:00:00.000Z',
        to: '2026-08-17T00:00:00.000Z',
      }),
    );
    expect(valid.statusCode).toBe(200);
    expect(valid.body).toMatchObject({
      status: 'SUCCESS',
    });
    if ('items' in valid.body) {
      const firstItem = valid.body.items[0];
      if (firstItem && 'customerName' in firstItem) {
        expect(firstItem.customerName).toBe('Amit Das');
      }
    }
  });

  it('exports all claims in csv with unmasked phone irrespective of filters', () => {
    const { drawApiHandler, adminApiHandler } = createHarness();

    drawApiHandler.handle(
      JSON.stringify({
        name: 'Amit Das',
        phone: '9123456789',
        billNumber: 'CSV-001',
      }),
    );

    drawApiHandler.handle(
      JSON.stringify({
        name: 'Riya Sen',
        phone: '9876543210',
        billNumber: 'CSV-002',
      }),
    );

    const response = adminApiHandler.exportClaimsCsv(
      new URLSearchParams({ search: 'Amit', pageSize: '1' }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain(
      '"date/time","claim ID","customer name","bill number","prize","phone"',
    );
    expect(response.body).toContain('Amit Das');
    expect(response.body).toContain('Riya Sen');
    expect(response.body).toContain('9123456789');
    expect(response.body).toContain('9876543210');
    expect(response.body).not.toContain('*****');
    expect(response.body).toContain('CSV-001');
    expect(response.body).toContain('CSV-002');
  });

  it('rejects a csv export that exceeds the row limit instead of truncating it', () => {
    const throwingStore = {
      listAdminClaimsForCsv: () => {
        throw new CsvExportTooLargeError(20000);
      },
    } as unknown as InMemoryDrawStore;

    const response = createAdminPrizeApiHandler(throwingStore).exportClaimsCsv(
      new URLSearchParams(),
    );

    expect(response.statusCode).toBe(413);
    expect(response.headers['content-type']).toContain('application/json');
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'ERROR',
      code: 'EXPORT_TOO_LARGE',
    });
  });

  it('deletes a single claim and decrements aggregates', () => {
    const { drawApiHandler, adminApiHandler } = createHarness();

    drawApiHandler.handle(
      JSON.stringify({
        name: 'Amit Das',
        phone: '9123456789',
        billNumber: 'DEL-001',
      }),
    );

    const claimsBefore = adminApiHandler.listClaims(new URLSearchParams());
    const claimId =
      'items' in claimsBefore.body &&
      claimsBefore.body.items[0] &&
      'claimId' in claimsBefore.body.items[0]
        ? claimsBefore.body.items[0].claimId
        : undefined;
    expect(claimId).toBeDefined();

    const summaryBefore = adminApiHandler.getSummary();
    expect(summaryBefore.body).toMatchObject({ totalSuccessfulSpins: 1 });

    const deleteResponse = adminApiHandler.deleteClaim(claimId as string);
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.body).toMatchObject({ status: 'SUCCESS' });

    const summaryAfter = adminApiHandler.getSummary();
    expect(summaryAfter.body).toMatchObject({ totalSuccessfulSpins: 0 });

    const claimsAfter = adminApiHandler.listClaims(new URLSearchParams());
    expect(claimsAfter.body).toMatchObject({ status: 'SUCCESS', items: [] });
  });

  it('returns validation error when deleting a claim that does not exist', () => {
    const { adminApiHandler } = createHarness();

    const response = adminApiHandler.deleteClaim('DB26-999999');
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      message: 'Claim was not found.',
    });
  });

  it('allows the same bill number to be reused for a draw after its claim is deleted', () => {
    const { drawApiHandler, adminApiHandler } = createHarness();

    drawApiHandler.handle(
      JSON.stringify({
        name: 'Amit Das',
        phone: '9123456789',
        billNumber: 'REUSE-001',
      }),
    );

    const claimsBefore = adminApiHandler.listClaims(new URLSearchParams());
    const claimId =
      'items' in claimsBefore.body &&
      claimsBefore.body.items[0] &&
      'claimId' in claimsBefore.body.items[0]
        ? claimsBefore.body.items[0].claimId
        : undefined;

    adminApiHandler.deleteClaim(claimId as string);

    const secondAttempt = drawApiHandler.handle(
      JSON.stringify({
        name: 'Riya Sen',
        phone: '9876543210',
        billNumber: 'REUSE-001',
      }),
    );

    expect(secondAttempt.statusCode).toBe(201);
    expect(secondAttempt.body).toMatchObject({ status: 'SUCCESS' });
  });

  it('clears all claims and resets aggregates to zero', () => {
    const { drawApiHandler, adminApiHandler } = createHarness();

    drawApiHandler.handle(
      JSON.stringify({ name: 'Amit Das', phone: '9123456789', billNumber: 'CLR-001' }),
    );
    drawApiHandler.handle(
      JSON.stringify({ name: 'Riya Sen', phone: '9876543210', billNumber: 'CLR-002' }),
    );

    const clearResponse = adminApiHandler.clearAllClaims();
    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.body).toMatchObject({ status: 'SUCCESS', deletedCount: 2 });

    const summaryAfter = adminApiHandler.getSummary();
    expect(summaryAfter.body).toMatchObject({
      status: 'SUCCESS',
      totalSuccessfulSpins: 0,
      prizeDistribution: [],
    });

    const claimsAfter = adminApiHandler.listClaims(new URLSearchParams());
    expect(claimsAfter.body).toMatchObject({ status: 'SUCCESS', items: [] });
  });
});

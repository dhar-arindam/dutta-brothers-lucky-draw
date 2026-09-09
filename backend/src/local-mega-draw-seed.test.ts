import { afterEach, describe, expect, it } from 'vitest';

import { createLocalMegaDrawSeed } from './local-mega-draw-seed.js';

const originalRuntime = process.env.APP_RUNTIME;

afterEach(() => {
  if (originalRuntime === undefined) {
    delete process.env.APP_RUNTIME;
  } else {
    process.env.APP_RUNTIME = originalRuntime;
  }
});

describe('local Mega Draw seed', () => {
  it('creates an ended current-year campaign with claims, aggregates, and Mega prizes', () => {
    process.env.APP_RUNTIME = 'LOCAL';
    const { store, megaDraw } = createLocalMegaDrawSeed(new Date('2026-09-07T12:00:00.000Z'));

    expect(store.getCampaign()).toMatchObject({
      id: 'festive-2026',
      timezone: 'Asia/Kolkata',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      status: 'ENDED',
    });
    expect(store.listActiveClaims()).toHaveLength(200);
    expect(new Set(store.listActiveClaims().map((claim) => claim.billNumberNormalized)).size).toBe(
      200,
    );
    expect(new Set(store.listActiveClaims().map((claim) => claim.phone)).size).toBe(200);
    expect(store.summary().totalSuccessfulSpins).toBe(200);
    expect(
      store.summary().prizeDistribution.reduce((sum, prize) => sum + prize.givenCount, 0),
    ).toBe(200);

    const preflight = megaDraw.preflight();
    expect(preflight).toMatchObject({ executionYear: 2026, candidateCount: 200 });
    expect(preflight.prizes).toHaveLength(3);

    const result = megaDraw.drawNext({
      preflightReference: preflight.reference,
      idempotencyKey: 'local-seed-test',
      operatorSubject: 'local-admin',
      acknowledgement: true,
      confirmation: 'DRAW NEXT MEGA PRIZE 2026',
    });
    expect(result.lifecycle.selectedRows).toHaveLength(1);
    expect(result.lifecycle.remainingPrizes).toHaveLength(2);
  });

  it('refuses to construct seeded data outside LOCAL runtime', () => {
    process.env.APP_RUNTIME = 'PRODUCTION';

    expect(() => createLocalMegaDrawSeed()).toThrow('APP_RUNTIME=LOCAL');
  });
});

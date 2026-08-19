import { describe, expect, it } from 'vitest';

import { ClaimIdGenerator } from './claim-id.js';
import type { DrawRequest } from './contracts.js';
import type { Campaign, Prize } from './domain.js';
import { DrawService } from './draw-service.js';
import { InMemoryDrawStore } from './store.js';

const fixedNow = new Date('2026-08-16T10:30:00.000Z');

const activeCampaign: Campaign = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-11-01T18:29:59.000Z',
};

const drawRequest: DrawRequest = {
  name: 'Arindam Roy',
  phone: '9876543210',
  billNumber: 'DB12345',
};

const defaultPrizes: Prize[] = [
  {
    id: 'prize-a',
    name: 'Prize A',
    displayName: 'Prize A',
    weight: 1,
    active: true,
  },
  {
    id: 'prize-b',
    name: 'Prize B',
    displayName: 'Prize B',
    weight: 3,
    active: true,
  },
  {
    id: 'prize-c',
    name: 'Prize C',
    displayName: 'Prize C',
    weight: 6,
    active: true,
  },
];

const buildService = (options?: {
  campaign?: Campaign;
  prizes?: Prize[];
  random?: () => number;
}) => {
  const store = new InMemoryDrawStore({
    initialPrizes: options?.prizes ?? defaultPrizes,
    now: () => fixedNow,
  });
  const service = new DrawService({
    campaign: options?.campaign ?? activeCampaign,
    claimIdGenerator: new ClaimIdGenerator(),
    store,
    random: options?.random ?? (() => 0.91),
    now: () => fixedNow,
  });

  return {
    service,
    store,
  };
};

describe('draw service validation', () => {
  it('accepts a valid request', () => {
    const { service } = buildService();

    const response = service.execute(drawRequest);

    expect(response.statusCode).toBe(201);
    expect(response.body.status).toBe('SUCCESS');
  });

  it('rejects invalid phone', () => {
    const { service } = buildService();

    const response = service.execute({
      ...drawRequest,
      phone: '987654321',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects invalid name', () => {
    const { service } = buildService();

    const response = service.execute({
      ...drawRequest,
      name: ' ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects invalid bill characters', () => {
    const { service } = buildService();

    const response = service.execute({
      ...drawRequest,
      billNumber: 'DB12345*',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });
  });

  it('normalizes bill and prevents equivalent duplicate claim', () => {
    const { service, store } = buildService();

    const first = service.execute({
      ...drawRequest,
      billNumber: ' db12345 ',
    });
    const second = service.execute({
      ...drawRequest,
      billNumber: 'DB12345',
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.body.status).toBe('ALREADY_CLAIMED');
    expect(store.snapshot().claimCount).toBe(1);
  });
});

describe('draw service lifecycle and prize selection', () => {
  it('rejects draw ended campaign', () => {
    const endedCampaign: Campaign = {
      ...activeCampaign,
      endAt: '2026-08-16T10:00:00.000Z',
    };
    const { service } = buildService({ campaign: endedCampaign });

    const response = service.execute(drawRequest);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
    });
  });

  it('returns no eligible prize when no active positive-weight prize exists', () => {
    const { service } = buildService({
      prizes: [
        {
          id: 'prize-a',
          name: 'Prize A',
          displayName: 'Prize A',
          weight: 0,
          active: true,
        },
      ],
    });

    const response = service.execute(drawRequest);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'NO_ELIGIBLE_PRIZE',
    });
  });

  it('selects the only eligible prize', () => {
    const { service } = buildService({
      prizes: [
        {
          id: 'prize-z',
          name: 'Only Prize',
          displayName: 'Only Prize',
          weight: 5,
          active: true,
        },
      ],
      random: () => 0.5,
    });

    const response = service.execute(drawRequest);

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      status: 'SUCCESS',
      prize: {
        id: 'prize-z',
      },
      wheel: {
        sectorPrizeIds: ['prize-z'],
      },
    });
  });

  it('follows weighted selection boundaries for multiple prizes', () => {
    const requestA = buildService({ random: () => 0.05 }).service.execute({
      ...drawRequest,
      billNumber: 'BILL-A',
    });

    const requestB = buildService({ random: () => 0.25 }).service.execute({
      ...drawRequest,
      billNumber: 'BILL-B',
    });

    const requestC = buildService({ random: () => 0.95 }).service.execute({
      ...drawRequest,
      billNumber: 'BILL-C',
    });

    expect(requestA.body).toMatchObject({
      status: 'SUCCESS',
      prize: { id: 'prize-a' },
    });
    expect(requestB.body).toMatchObject({
      status: 'SUCCESS',
      prize: { id: 'prize-b' },
    });
    expect(requestC.body).toMatchObject({
      status: 'SUCCESS',
      prize: { id: 'prize-c' },
    });
  });

  it('enforces updated campaign values from campaign provider', () => {
    let currentCampaign: Campaign = {
      ...activeCampaign,
      endAt: '2026-08-16T11:00:00.000Z',
    };

    const store = new InMemoryDrawStore({
      initialPrizes: defaultPrizes,
      now: () => fixedNow,
    });

    const service = new DrawService({
      getCampaign: () => currentCampaign,
      claimIdGenerator: new ClaimIdGenerator(),
      store,
      random: () => 0.91,
      now: () => fixedNow,
    });

    const first = service.execute({
      ...drawRequest,
      billNumber: 'BILL-DYNAMIC-1',
    });
    expect(first.statusCode).toBe(201);

    currentCampaign = {
      ...currentCampaign,
      endAt: '2026-08-16T09:00:00.000Z',
    };

    const second = service.execute({
      ...drawRequest,
      billNumber: 'BILL-DYNAMIC-2',
    });
    expect(second.statusCode).toBe(409);
    expect(second.body).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
    });
  });
});

describe('draw service bill uniqueness, claim, and aggregates', () => {
  it('creates one claim and rejects duplicate bill from another customer', () => {
    const { service, store } = buildService();

    const first = service.execute(drawRequest);
    const second = service.execute({
      name: 'Rahul Sen',
      phone: '9999999999',
      billNumber: 'DB12345',
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.body.status).toBe('ALREADY_CLAIMED');
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);
  });

  it('is retry-safe and returns original claim details', () => {
    const { service, store } = buildService();

    const first = service.execute(drawRequest);
    const retry = service.execute(drawRequest);

    expect(first.body.status).toBe('SUCCESS');
    expect(retry.body.status).toBe('ALREADY_CLAIMED');

    if (first.body.status === 'SUCCESS' && retry.body.status === 'ALREADY_CLAIMED') {
      expect(retry.body.claimId).toBe(first.body.claimId);
      expect(retry.body.claimTimestamp).toBe(first.body.claimTimestamp);
      expect(retry.body.prize.id).toBe(first.body.prize.id);
    }

    expect(store.snapshot().claimCount).toBe(1);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);
  });

  it('creates claim id server-side with required format and preserves prize snapshot', () => {
    const mutablePrizes: Prize[] = [
      {
        id: 'prize-1',
        name: 'Electric Kettle',
        displayName: 'Electric Kettle',
        weight: 1,
        active: true,
      },
    ];

    const { service } = buildService({
      prizes: mutablePrizes,
      random: () => 0,
    });

    const first = service.execute(drawRequest);
    const firstPrize = mutablePrizes[0];
    if (!firstPrize) {
      throw new Error('Expected seeded prize to exist.');
    }

    firstPrize.name = 'Changed Name';
    firstPrize.displayName = 'Changed Name';
    const retry = service.execute(drawRequest);

    expect(first.body.status).toBe('SUCCESS');
    if (first.body.status === 'SUCCESS') {
      expect(first.body.claimId).toMatch(/^DB26-\d{6}$/);
      expect(first.body.prize.displayName).toBe('Electric Kettle');
    }

    expect(retry.body.status).toBe('ALREADY_CLAIMED');
    if (retry.body.status === 'ALREADY_CLAIMED') {
      expect(retry.body.prize.displayName).toBe('Electric Kettle');
    }
  });

  it('does not increment aggregates on validation, draw ended, or no eligible prize', () => {
    const validationService = buildService().service;
    const drawEnded = buildService({
      campaign: {
        ...activeCampaign,
        endAt: '2026-08-16T00:00:00.000Z',
      },
    });
    const noPrize = buildService({
      prizes: [
        {
          id: 'none',
          name: 'None',
          displayName: 'None',
          weight: 0,
          active: true,
        },
      ],
    });

    const invalidResponse = validationService.execute({
      ...drawRequest,
      phone: 'abc',
    });
    const endedResponse = drawEnded.service.execute(drawRequest);
    const noPrizeResponse = noPrize.service.execute(drawRequest);

    expect(invalidResponse.statusCode).toBe(400);
    expect(endedResponse.statusCode).toBe(409);
    expect(noPrizeResponse.statusCode).toBe(409);

    expect(drawEnded.store.snapshot().aggregate.totalSuccessfulSpins).toBe(0);
    expect(noPrize.store.snapshot().aggregate.totalSuccessfulSpins).toBe(0);
  });

  it('handles concurrent duplicate requests with exactly one claim and one aggregate increment', async () => {
    const { service, store } = buildService();

    const tasks = Array.from({ length: 20 }, (_, index) => {
      const suffix = index.toString().padStart(2, '0');
      return Promise.resolve(
        service.execute({
          name: 'Concurrent Customer',
          phone: `98765432${suffix}`,
          billNumber: 'CONCURRENT-001',
        }),
      );
    });

    const results = await Promise.all(tasks);
    const successes = results.filter((result) => result.body.status === 'SUCCESS');
    const duplicates = results.filter((result) => result.body.status === 'ALREADY_CLAIMED');

    expect(successes).toHaveLength(1);
    expect(duplicates).toHaveLength(19);

    const snapshot = store.snapshot();
    expect(snapshot.claimCount).toBe(1);
    expect(snapshot.aggregate.totalSuccessfulSpins).toBe(1);
  });
});

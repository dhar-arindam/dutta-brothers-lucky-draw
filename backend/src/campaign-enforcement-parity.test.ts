import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaimIdGenerator } from './claim-id.js';
import type { DrawRequest } from './contracts.js';
import { DrawService } from './draw-service.js';
import { InMemoryDrawStore } from './store.js';

const mockLambdaState = vi.hoisted(() => {
  return {
    campaign: {
      id: 'festive-2026',
      timezone: 'Asia/Kolkata' as const,
      fromDate: '2026-08-16',
      toDate: '2026-08-20',
      status: 'ACTIVE' as 'ACTIVE' | 'ENDED',
    },
    listEligibleCalls: 0,
    createClaimCalls: 0,
  };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class {},
  };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({ mocked: true }),
    },
  };
});

vi.mock('./durable-dynamodb-store.js', () => {
  class DynamoDbDrawStore {
    public constructor() {}

    public async getCampaign() {
      return mockLambdaState.campaign;
    }

    public async listEligiblePrizesForDraw() {
      mockLambdaState.listEligibleCalls += 1;
      return [
        {
          id: 'prize-001',
          name: 'Electric Kettle',
          displayName: 'Electric Kettle',
          weight: 1,
          active: true,
        },
      ];
    }

    public async createClaimAndUpdateAggregatesAtomic() {
      mockLambdaState.createClaimCalls += 1;
      return {
        type: 'CREATED' as const,
        claim: {
          claimId: 'DB26-000001',
          claimTimestamp: new Date().toISOString(),
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
      };
    }

    public async listAllPrizes() {
      return [];
    }

    public async addPrize() {
      throw new Error('not used in this test');
    }

    public async updatePrize() {
      throw new Error('not used in this test');
    }

    public async listAdminClaims() {
      return { items: [], nextPageToken: null };
    }

    public async summary() {
      return {
        totalSuccessfulSpins: 0,
        today: { date: '2026-08-16', successfulSpins: 0 },
        prizeDistribution: [],
      };
    }

    public async updateCampaign() {
      return {
        type: 'SUCCESS' as const,
        campaign: {
          id: 'festive-2026',
          timezone: 'Asia/Kolkata' as const,
          fromDate: '2026-08-16',
          toDate: '2026-08-20',
        },
      };
    }
  }

  return { DynamoDbDrawStore };
});

const drawRequest: DrawRequest = {
  name: 'Arindam Roy',
  phone: '9876543210',
  billNumber: 'DB12345',
};

const campaignWindow = {
  fromDate: '2026-08-16',
  toDate: '2026-08-20',
};

const evaluateLocalRuntime = (nowIso: string) => {
  const now = new Date(nowIso);
  const store = new InMemoryDrawStore({
    now: () => now,
  });

  const service = new DrawService({
    getCampaign: () => campaignWindow,
    claimIdGenerator: new ClaimIdGenerator(),
    store,
    random: () => 0,
    now: () => now,
  });

  const response = service.execute(drawRequest);
  const snapshot = store.snapshot();

  return { response, snapshot };
};

const evaluateLambdaRuntime = async (nowIso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(nowIso));
  vi.resetModules();

  process.env.APP_RUNTIME = 'PRODUCTION';
  process.env.DRAWS_TABLE_NAME = 'draws-table';
  mockLambdaState.campaign = {
    id: 'festive-2026',
    timezone: 'Asia/Kolkata',
    fromDate: '2026-08-16',
    toDate: '2026-08-20',
    status: 'ACTIVE',
  };
  mockLambdaState.listEligibleCalls = 0;
  mockLambdaState.createClaimCalls = 0;

  const { handler } = await import('./lambda.js');
  const response = await handler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/draw',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(drawRequest),
  });

  return {
    response,
    listEligibleCalls: mockLambdaState.listEligibleCalls,
    createClaimCalls: mockLambdaState.createClaimCalls,
  };
};

describe('campaign enforcement parity across local and lambda runtimes', () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete process.env.APP_RUNTIME;
    delete process.env.DRAWS_TABLE_NAME;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces before/start/during/end/after boundaries identically', async () => {
    const matrix = [
      { name: 'before fromDate', nowIso: '2026-08-15T18:29:59.999Z', allowed: false },
      { name: 'on fromDate', nowIso: '2026-08-15T18:30:00.000Z', allowed: true },
      { name: 'between fromDate and toDate', nowIso: '2026-08-18T12:00:00.000Z', allowed: true },
      { name: 'on toDate', nowIso: '2026-08-20T18:29:59.999Z', allowed: true },
      { name: 'after toDate', nowIso: '2026-08-20T18:30:00.000Z', allowed: false },
    ];

    for (const item of matrix) {
      const local = evaluateLocalRuntime(item.nowIso);
      const lambda = await evaluateLambdaRuntime(item.nowIso);
      const lambdaBody = JSON.parse(lambda.response.body) as { status: string; code?: string };

      if (item.allowed) {
        expect(local.response.statusCode, `${item.name} local`).toBe(201);
        expect(local.response.body.status, `${item.name} local status`).toBe('SUCCESS');
        expect(local.snapshot.claimCount, `${item.name} local claim count`).toBe(1);

        expect(lambda.response.statusCode, `${item.name} lambda`).toBe(201);
        expect(lambdaBody.status, `${item.name} lambda status`).toBe('SUCCESS');
        expect(lambda.listEligibleCalls, `${item.name} lambda eligibility calls`).toBe(1);
        expect(lambda.createClaimCalls, `${item.name} lambda create calls`).toBe(1);
      } else {
        expect(local.response.statusCode, `${item.name} local`).toBe(409);
        expect(local.response.body).toMatchObject({
          status: 'ERROR',
          code: 'DRAW_ENDED',
        });
        expect(local.snapshot.claimCount, `${item.name} local claim count`).toBe(0);
        expect(
          local.snapshot.aggregate.totalSuccessfulSpins,
          `${item.name} local aggregate total`,
        ).toBe(0);
        expect(
          Object.keys(local.snapshot.aggregate.byPrizeId),
          `${item.name} local prize aggregate`,
        ).toHaveLength(0);

        expect(lambda.response.statusCode, `${item.name} lambda`).toBe(409);
        expect(lambdaBody).toMatchObject({
          status: 'ERROR',
          code: 'DRAW_ENDED',
        });
        expect(lambda.listEligibleCalls, `${item.name} lambda eligibility calls`).toBe(0);
        expect(lambda.createClaimCalls, `${item.name} lambda create calls`).toBe(0);
      }
    }
  }, 15000);

  it('enforces Asia/Kolkata midnight boundary and utc transition consistently', async () => {
    const justBeforeIstMidnight = '2026-08-15T18:29:59.999Z';
    const atIstMidnight = '2026-08-15T18:30:00.000Z';

    const localBefore = evaluateLocalRuntime(justBeforeIstMidnight);
    const lambdaBefore = await evaluateLambdaRuntime(justBeforeIstMidnight);
    const lambdaBeforeBody = JSON.parse(lambdaBefore.response.body) as {
      status: string;
      code?: string;
    };

    expect(localBefore.response.statusCode).toBe(409);
    expect(localBefore.response.body).toMatchObject({ status: 'ERROR', code: 'DRAW_ENDED' });
    expect(lambdaBefore.response.statusCode).toBe(409);
    expect(lambdaBeforeBody).toMatchObject({ status: 'ERROR', code: 'DRAW_ENDED' });

    const localAtBoundary = evaluateLocalRuntime(atIstMidnight);
    const lambdaAtBoundary = await evaluateLambdaRuntime(atIstMidnight);
    const lambdaAtBoundaryBody = JSON.parse(lambdaAtBoundary.response.body) as { status: string };

    expect(localAtBoundary.response.statusCode).toBe(201);
    expect(localAtBoundary.response.body.status).toBe('SUCCESS');
    expect(lambdaAtBoundary.response.statusCode).toBe(201);
    expect(lambdaAtBoundaryBody.status).toBe('SUCCESS');
  });

  it('keeps ended-campaign draw safety identical across runtimes', async () => {
    const nowIso = '2026-08-19T06:00:00.000Z';
    const endedCampaign = {
      fromDate: '2026-08-01',
      toDate: '2026-08-18',
    };

    const localNow = new Date(nowIso);
    const localStore = new InMemoryDrawStore({ now: () => localNow });
    const localService = new DrawService({
      getCampaign: () => endedCampaign,
      claimIdGenerator: new ClaimIdGenerator(),
      store: localStore,
      random: () => 0,
      now: () => localNow,
    });
    const localResponse = localService.execute(drawRequest);
    const localSnapshot = localStore.snapshot();

    expect(localResponse.statusCode).toBe(409);
    expect(localResponse.body).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
      message:
        'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
    });
    expect(localSnapshot.claimCount).toBe(0);
    expect(localSnapshot.aggregate.totalSuccessfulSpins).toBe(0);
    expect(Object.keys(localSnapshot.aggregate.byPrizeId)).toHaveLength(0);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowIso));
    vi.resetModules();
    process.env.APP_RUNTIME = 'PRODUCTION';
    process.env.DRAWS_TABLE_NAME = 'draws-table';

    mockLambdaState.campaign = {
      id: 'festive-2026',
      timezone: 'Asia/Kolkata',
      fromDate: '2026-08-01',
      toDate: '2026-08-18',
      status: 'ENDED',
    };
    mockLambdaState.listEligibleCalls = 0;
    mockLambdaState.createClaimCalls = 0;

    const { handler } = await import('./lambda.js');
    const lambdaResponse = await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/draw',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(drawRequest),
    });
    const lambdaBody = JSON.parse(lambdaResponse.body) as {
      status: string;
      code?: string;
      message?: string;
    };

    expect(lambdaResponse.statusCode).toBe(409);
    expect(lambdaBody).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
      message:
        'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
    });
    expect(mockLambdaState.listEligibleCalls).toBe(0);
    expect(mockLambdaState.createClaimCalls).toBe(0);
  });

  it('returns matching draw-ended error contract for both runtimes when campaign is not active', async () => {
    const nowIso = '2026-08-20T18:30:00.000Z';
    const local = evaluateLocalRuntime(nowIso);
    const lambda = await evaluateLambdaRuntime(nowIso);
    const lambdaBody = JSON.parse(lambda.response.body) as {
      status: string;
      code?: string;
      message?: string;
    };

    expect(local.response.statusCode).toBe(409);
    expect(local.response.body).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
      message:
        'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
    });

    expect(lambda.response.statusCode).toBe(409);
    expect(lambdaBody).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
      message:
        'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
    });
  });
});

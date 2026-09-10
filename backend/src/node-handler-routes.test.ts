import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultNodeHandler,
  createNodeHandler,
  type AdminPrizeApiHandler,
  type DrawApiHandler,
} from './app.js';
import type { AdminPrize, DrawHttpResponse } from './contracts.js';
import { MegaDrawError, type MegaDrawErrorCode } from './mega-draw.js';

const drawSuccess: DrawHttpResponse = {
  statusCode: 201,
  body: {
    status: 'SUCCESS' as const,
    claimId: 'DB26-000001',
    claimTimestamp: '2026-08-16T10:30:00.000Z',
    prize: {
      id: 'prize-001',
      name: 'Electric Kettle',
      displayName: 'Electric Kettle',
    },
    wheel: {
      sectorPrizeIds: ['prize-001'],
    },
  },
};

const adminPrizeItem: AdminPrize = {
  id: 'prize-001',
  name: 'Electric Kettle',
  weight: 1,
  active: true,
  givenCount: 0,
  createdAt: '2026-08-16T10:30:00.000Z',
  updatedAt: '2026-08-16T10:30:00.000Z',
};

describe('node handler admin and routing coverage', () => {
  const openServers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      openServers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    openServers.length = 0;
  });

  const start = async (
    drawApiHandler: DrawApiHandler,
    adminPrizeApiHandler: AdminPrizeApiHandler,
  ) => {
    const nodeHandler = createNodeHandler({ drawApiHandler, adminPrizeApiHandler });
    const server = createServer((req, res) => {
      void nodeHandler(req, res);
    });
    openServers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve address.');
    }

    return `http://127.0.0.1:${address.port}`;
  };

  it('enables Mega Draw routes by default in local runtime', async () => {
    const previousRuntime = process.env.APP_RUNTIME;
    const previousSeed = process.env.LOCAL_MEGA_DRAW_SEED;
    process.env.APP_RUNTIME = 'LOCAL';
    delete process.env.LOCAL_MEGA_DRAW_SEED;

    try {
      const handler = createDefaultNodeHandler();
      const server = createServer((req, res) => {
        void handler(req, res);
      });
      openServers.push(server);

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Could not resolve address.');
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/mega-draw`);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { status: string };
      expect(payload.status).toBe('SUCCESS');

      const summaryResponse = await fetch(`http://127.0.0.1:${address.port}/api/admin/summary`);
      expect(summaryResponse.status).toBe(200);
      const summaryPayload = (await summaryResponse.json()) as {
        totalSuccessfulSpins?: number;
      };
      expect(summaryPayload.totalSuccessfulSpins).toBe(0);
    } finally {
      if (previousRuntime === undefined) delete process.env.APP_RUNTIME;
      else process.env.APP_RUNTIME = previousRuntime;
      if (previousSeed === undefined) delete process.env.LOCAL_MEGA_DRAW_SEED;
      else process.env.LOCAL_MEGA_DRAW_SEED = previousSeed;
    }
  });

  it('routes all admin endpoints and 404 correctly', async () => {
    const drawHandler: DrawApiHandler = {
      handle: () => drawSuccess,
    };

    const listPrizes = vi.fn<AdminPrizeApiHandler['listPrizes']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS', items: [adminPrizeItem] },
    }));
    const addPrize = vi.fn<AdminPrizeApiHandler['addPrize']>(() => ({
      statusCode: 201,
      body: {
        status: 'SUCCESS',
        item: { ...adminPrizeItem, id: 'prize-010', name: 'Mixer Grinder' },
      },
    }));
    const updatePrize = vi.fn<AdminPrizeApiHandler['updatePrize']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS', item: adminPrizeItem },
    }));
    const listClaims = vi.fn<AdminPrizeApiHandler['listClaims']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS', items: [], nextPageToken: null },
    }));
    const deleteClaim = vi.fn<AdminPrizeApiHandler['deleteClaim']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS' },
    }));
    const clearAllClaims = vi.fn<AdminPrizeApiHandler['clearAllClaims']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS', deletedCount: 0 },
    }));
    const exportClaimsCsv = vi.fn<AdminPrizeApiHandler['exportClaimsCsv']>(() => ({
      statusCode: 200,
      headers: { 'content-type': 'text/csv' },
      body: 'h1,h2',
    }));
    const getSummary = vi.fn<AdminPrizeApiHandler['getSummary']>(() => ({
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        totalSuccessfulSpins: 0,
        today: { date: '2026-08-16', successfulSpins: 0 },
        prizeDistribution: [],
      },
    }));
    const getCampaign = vi.fn<AdminPrizeApiHandler['getCampaign']>(() => ({
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        campaign: {
          id: 'festive-2026',
          fromDate: '2026-08-01',
          toDate: '2026-11-01',
          timezone: 'Asia/Kolkata',
          status: 'ACTIVE',
        },
      },
    }));
    const updateCampaign = vi.fn<AdminPrizeApiHandler['updateCampaign']>(() => ({
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        campaign: {
          id: 'festive-2026',
          fromDate: '2026-08-01',
          toDate: '2026-12-01',
          timezone: 'Asia/Kolkata',
          status: 'ACTIVE',
        },
      },
    }));

    const adminHandler: AdminPrizeApiHandler = {
      listPrizes,
      addPrize,
      updatePrize,
      listClaims,
      deleteClaim,
      clearAllClaims,
      exportClaimsCsv,
      getSummary,
      getCampaign,
      updateCampaign,
    };

    const baseUrl = await start(drawHandler, adminHandler);

    expect((await fetch(`${baseUrl}/api/admin/prizes`)).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/prizes`, {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/prizes/prize-001`, {
          method: 'PATCH',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/claims?pageSize=25`)).status).toBe(200);
    expect(
      (await fetch(`${baseUrl}/api/admin/claims/DB26-000001`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/claims`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/claims.csv?pageSize=999`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/summary`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/campaign`)).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/campaign`, {
          method: 'PATCH',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(200);

    const notFound = await fetch(`${baseUrl}/api/unknown`);
    expect(notFound.status).toBe(404);

    expect(listPrizes).toHaveBeenCalledTimes(1);
    expect(addPrize).toHaveBeenCalledTimes(1);
    expect(updatePrize).toHaveBeenCalledWith('prize-001', '{}');
    expect(listClaims).toHaveBeenCalledTimes(1);
    expect(deleteClaim).toHaveBeenCalledWith('DB26-000001');
    expect(clearAllClaims).toHaveBeenCalledTimes(1);
    expect(exportClaimsCsv).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getCampaign).toHaveBeenCalledTimes(1);
    expect(updateCampaign).toHaveBeenCalledTimes(1);
  });

  it('routes Mega Draw operations and returns validation and domain errors', async () => {
    const drawHandler: DrawApiHandler = { handle: () => drawSuccess };
    const adminHandler: AdminPrizeApiHandler = {
      listPrizes: () => ({ statusCode: 200, body: { status: 'SUCCESS', items: [] } }),
      addPrize: () => ({ statusCode: 201, body: { status: 'SUCCESS', item: adminPrizeItem } }),
      updatePrize: () => ({ statusCode: 200, body: { status: 'SUCCESS', item: adminPrizeItem } }),
      listClaims: () => ({
        statusCode: 200,
        body: { status: 'SUCCESS', items: [], nextPageToken: null },
      }),
      deleteClaim: () => ({ statusCode: 200, body: { status: 'SUCCESS' } }),
      clearAllClaims: () => ({ statusCode: 200, body: { status: 'SUCCESS', deletedCount: 0 } }),
      exportClaimsCsv: () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/csv' },
        body: '',
      }),
      getSummary: () => ({
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: { date: '2026-08-16', successfulSpins: 0 },
          prizeDistribution: [],
        },
      }),
      getCampaign: () => ({
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            timezone: 'Asia/Kolkata',
            status: 'ENDED',
          },
        },
      }),
      updateCampaign: () => ({
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            timezone: 'Asia/Kolkata',
            status: 'ENDED',
          },
        },
      }),
    };
    const megaDraw = {
      get: () => ({ configuration: [], history: [] }),
      status: () => ({ execution: 'NOT_FOUND' as const }),
      configure: (prizes: string[]) => prizes.map((name, index) => ({ position: index + 1, name })),
      preflight: () => ({ reference: 'PF-1' }),
      drawNext: () => ({ lifecycle: { status: 'COMPLETED' }, selectedRow: {} }),
      reset: () => ({ executionYear: 2026 }),
      close: () => ({ lifecycle: { status: 'CLOSED' } }),
      reopen: () => ({ executionYear: 2026, cycleNumber: 2 }),
    };
    const baseUrl = await (async () => {
      const nodeHandler = createNodeHandler({
        drawApiHandler: drawHandler,
        adminPrizeApiHandler: adminHandler,
        megaDraw: megaDraw as never,
      });
      const server = createServer((req, res) => void nodeHandler(req, res));
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not resolve address.');
      return `http://127.0.0.1:${address.port}`;
    })();
    const jsonHeaders = { 'content-type': 'application/json' };
    const json = (body: unknown) => JSON.stringify(body);

    expect((await fetch(`${baseUrl}/api/admin/mega-draw`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/mega-draw/status/`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/admin/mega-draw/status/key%201`)).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/mega-draw/configuration`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: json({ prizes: ['TV'] }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/mega-draw/configuration`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (await fetch(`${baseUrl}/api/admin/mega-draw/preflight`, { method: 'POST' })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/mega-draw/draw-next`, {
          method: 'POST',
          headers: jsonHeaders,
          body: '{}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/mega-draw/draw-next`, {
          method: 'POST',
          headers: { ...jsonHeaders, 'Idempotency-Key': 'draw-1' },
          body: json({}),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/mega-draw/reset`, {
          method: 'POST',
          headers: jsonHeaders,
          body: json({ acknowledgement: true, confirmation: 'RESET' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/mega-draw/close`, {
          method: 'POST',
          headers: jsonHeaders,
          body: json({ acknowledgement: true, confirmation: 'CLOSE' }),
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/mega-draw/reopen`, { method: 'POST' })).status).toBe(
      200,
    );

    let errorCode: MegaDrawErrorCode = 'CAMPAIGN_NOT_ENDED';
    const failingMegaDraw = {
      ...megaDraw,
      preflight: () => {
        throw new MegaDrawError(errorCode, 'Mega Draw operation failed.');
      },
    };
    const failingHandler = createNodeHandler({
      drawApiHandler: drawHandler,
      adminPrizeApiHandler: adminHandler,
      megaDraw: failingMegaDraw as never,
    });
    const failingServer = createServer((req, res) => void failingHandler(req, res));
    openServers.push(failingServer);
    await new Promise<void>((resolve) => failingServer.listen(0, '127.0.0.1', resolve));
    const failingAddress = failingServer.address();
    if (!failingAddress || typeof failingAddress === 'string')
      throw new Error('Could not resolve address.');
    const failingUrl = `http://127.0.0.1:${failingAddress.port}/api/admin/mega-draw/preflight`;
    for (const [code, expectedStatus] of [
      ['CAMPAIGN_NOT_ENDED', 409],
      ['INSUFFICIENT_ELIGIBLE_PARTICIPANTS', 409],
      ['MEGA_DRAW_IN_PROGRESS', 409],
      ['MEGA_DRAW_ALREADY_COMPLETED', 409],
      ['MEGA_DRAW_CLOSED', 409],
      ['MEGA_DRAW_REOPEN_NOT_ALLOWED', 409],
      ['VALIDATION_ERROR', 400],
      ['MEGA_DRAW_NOT_CONFIGURED', 400],
    ] as const) {
      errorCode = code;
      expect((await fetch(failingUrl, { method: 'POST' })).status).toBe(expectedStatus);
    }
  });
});

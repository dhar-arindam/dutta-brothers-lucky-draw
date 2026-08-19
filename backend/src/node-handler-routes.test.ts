import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeHandler, type AdminPrizeApiHandler, type DrawApiHandler } from './app.js';
import type { AdminPrize, DrawHttpResponse } from './contracts.js';

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

  const start = async (drawApiHandler: DrawApiHandler, adminPrizeApiHandler: AdminPrizeApiHandler) => {
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
      body: { status: 'SUCCESS', item: { ...adminPrizeItem, id: 'prize-010', name: 'Mixer Grinder' } },
    }));
    const updatePrize = vi.fn<AdminPrizeApiHandler['updatePrize']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS', item: adminPrizeItem },
    }));
    const listClaims = vi.fn<AdminPrizeApiHandler['listClaims']>(() => ({
      statusCode: 200,
      body: { status: 'SUCCESS', items: [], nextPageToken: null },
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
      exportClaimsCsv,
      getSummary,
      getCampaign,
      updateCampaign,
    };

    const baseUrl = await start(drawHandler, adminHandler);

    expect((await fetch(`${baseUrl}/api/admin/prizes`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/prizes`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(201);
    expect((await fetch(`${baseUrl}/api/admin/prizes/prize-001`, { method: 'PATCH', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/claims?pageSize=25`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/claims.csv?pageSize=999`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/summary`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/campaign`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/admin/campaign`, { method: 'PATCH', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(200);

    const notFound = await fetch(`${baseUrl}/api/unknown`);
    expect(notFound.status).toBe(404);

    expect(listPrizes).toHaveBeenCalledTimes(1);
    expect(addPrize).toHaveBeenCalledTimes(1);
    expect(updatePrize).toHaveBeenCalledWith('prize-001', '{}');
    expect(listClaims).toHaveBeenCalledTimes(1);
    expect(exportClaimsCsv).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getCampaign).toHaveBeenCalledTimes(1);
    expect(updateCampaign).toHaveBeenCalledTimes(1);
  });
});

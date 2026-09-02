import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createNodeHandler, type AdminPrizeApiHandler, type DrawApiHandler } from './app.js';

const adminPrizeItem = {
  id: 'prize-001',
  name: 'Prize 001',
  weight: 1,
  active: true,
  givenCount: 0,
  createdAt: '2026-08-16T10:30:00.000Z',
  updatedAt: '2026-08-16T10:30:00.000Z',
};

const createAdminStub = (): AdminPrizeApiHandler => ({
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
    body: 'h1,h2',
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
        timezone: 'Asia/Kolkata',
        fromDate: '2026-08-01',
        toDate: '2026-11-01',
        status: 'ACTIVE',
      },
    },
  }),
  updateCampaign: () => ({
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      campaign: {
        id: 'festive-2026',
        timezone: 'Asia/Kolkata',
        fromDate: '2026-08-01',
        toDate: '2026-11-01',
        status: 'ACTIVE',
      },
    },
  }),
});

const invoke = async (input: {
  method: string;
  path: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  drawHandler: DrawApiHandler;
  adminHandler?: AdminPrizeApiHandler;
}) => {
  const handler = createNodeHandler({
    drawApiHandler: input.drawHandler,
    adminPrizeApiHandler: input.adminHandler ?? createAdminStub(),
  });

  const req = Readable.from([input.body ?? '']) as Readable & {
    method?: string;
    url?: string;
    headers: Record<string, string | string[]>;
  };

  req.method = input.method;
  req.url = input.path;
  req.headers = input.headers ?? {};

  const output: { statusCode?: number; body?: string; headers?: Record<string, string> } = {};
  const res = {
    writeHead: (statusCode: number, headers: Record<string, string>) => {
      output.statusCode = statusCode;
      output.headers = headers;
    },
    end: (body?: string) => {
      if (body !== undefined) {
        output.body = body;
      }
    },
  };

  await handler(req as never, res as never);
  return output;
};

describe('node handler branch behavior', () => {
  it('uses first idempotency key header value when header array is provided', async () => {
    const observed: Array<string | undefined> = [];
    const drawHandler: DrawApiHandler = {
      handle: (_body, context) => {
        observed.push(context?.idempotencyKey);
        return {
          statusCode: 201,
          body: {
            status: 'SUCCESS',
            claimId: 'DB26-000001',
            claimTimestamp: '2026-08-16T10:30:00.000Z',
            prize: { id: 'prize-001', name: 'Prize', displayName: 'Prize' },
            wheel: { sectorPrizeIds: ['prize-001'] },
          },
        };
      },
    };

    const body = JSON.stringify({ name: 'Amit Das', phone: '9876543210', billNumber: 'AB123' });

    const response = await invoke({
      method: 'POST',
      path: '/api/draw',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': ['first-key', 'second-key'],
      },
      body,
      drawHandler,
    });

    expect(response.statusCode).toBe(201);
    expect(observed).toEqual(['first-key']);
  });

  it('returns 413 for oversized PATCH campaign and PATCH prize updates', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const drawHandler: DrawApiHandler = {
      handle: () => ({
        statusCode: 201,
        body: {
          status: 'SUCCESS',
          claimId: 'DB26-000001',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          prize: { id: 'prize-001', name: 'Prize', displayName: 'Prize' },
          wheel: { sectorPrizeIds: ['prize-001'] },
        },
      }),
    };

    const oversizedBody = JSON.stringify({ pad: 'a'.repeat(33 * 1024) });

    const campaignResponse = await invoke({
      method: 'PATCH',
      path: '/api/admin/campaign',
      headers: {
        'content-type': 'application/json',
        'x-request-id': ['req-1', 'req-2'],
      },
      body: oversizedBody,
      drawHandler,
    });

    const prizeResponse = await invoke({
      method: 'PATCH',
      path: '/api/admin/prizes/prize-001',
      headers: {
        'content-type': 'application/json',
        'x-request-id': ['req-3', 'req-4'],
      },
      body: oversizedBody,
      drawHandler,
    });

    expect(campaignResponse.statusCode).toBe(413);
    expect(prizeResponse.statusCode).toBe(413);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rethrows non-size body read errors for PATCH campaign and prize routes', async () => {
    const drawHandler: DrawApiHandler = {
      handle: () => ({
        statusCode: 201,
        body: {
          status: 'SUCCESS',
          claimId: 'DB26-000001',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          prize: { id: 'prize-001', name: 'Prize', displayName: 'Prize' },
          wheel: { sectorPrizeIds: ['prize-001'] },
        },
      }),
    };

    const makeBrokenReq = (method: string, path: string) => {
      const req = new Readable({
        read() {
          this.destroy(new Error('stream-failure'));
        },
      }) as Readable & {
        method?: string;
        url?: string;
        headers: Record<string, string>;
      };
      req.method = method;
      req.url = path;
      req.headers = { 'content-type': 'application/json' };
      return req;
    };

    const admin = createAdminStub();
    const handler = createNodeHandler({ drawApiHandler: drawHandler, adminPrizeApiHandler: admin });
    const response = {
      writeHead: () => undefined,
      end: () => undefined,
    };

    await expect(
      handler(makeBrokenReq('PATCH', '/api/admin/campaign') as never, response as never),
    ).rejects.toThrow('stream-failure');
    await expect(
      handler(makeBrokenReq('PATCH', '/api/admin/prizes/prize-001') as never, response as never),
    ).rejects.toThrow('stream-failure');
  });
});

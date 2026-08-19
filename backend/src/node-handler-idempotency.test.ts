import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultNodeHandler, createNodeHandler, type DrawApiHandler } from './app.js';

const createJsonFetchInit = (idempotencyKey?: string): RequestInit => {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey
        ? {
            'idempotency-key': idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify({
      name: 'Arindam Roy',
      phone: '9876543210',
      billNumber: 'DB12345',
    }),
  };
};

describe('node handler idempotency header propagation', () => {
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

  const startWithHandler = async (drawApiHandler: DrawApiHandler): Promise<string> => {
    const nodeHandler = createNodeHandler({
      drawApiHandler,
      adminPrizeApiHandler: {
        listPrizes: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
        addPrize: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
        updatePrize: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
        listClaims: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
        exportClaimsCsv: () => ({
          statusCode: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' }),
        }),
        getSummary: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
        getCampaign: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
        updateCampaign: () => ({ statusCode: 500, body: { status: 'ERROR', code: 'INTERNAL_ERROR', message: 'n/a' } }),
      },
    });

    const server = createServer((req, res) => {
      void nodeHandler(req, res);
    });

    openServers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve test server address.');
    }

    return `http://127.0.0.1:${address.port}`;
  };

  it('passes idempotency key from request header to draw handler context', async () => {
    const observedKeys: Array<string | undefined> = [];

    const drawApiHandler: DrawApiHandler = {
      handle: (_body, context) => {
        observedKeys.push(context?.idempotencyKey);
        return {
          statusCode: 201,
          body: {
            status: 'SUCCESS',
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
      },
    };

    const baseUrl = await startWithHandler(drawApiHandler);

    await fetch(`${baseUrl}/api/draw`, createJsonFetchInit('key-123'));
    await fetch(`${baseUrl}/api/draw`, createJsonFetchInit());

    expect(observedKeys).toEqual(['key-123', undefined]);
  });

  it('preserves duplicate prevention behavior for retry with the same idempotency key', async () => {
    const nodeHandler = createDefaultNodeHandler();
    const server = createServer((req, res) => {
      void nodeHandler(req, res);
    });
    openServers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve test server address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const init = createJsonFetchInit('retry-key-1');

    const firstResponse = await fetch(`${baseUrl}/api/draw`, init);
    const firstBody = (await firstResponse.json()) as { status: string; claimId: string };

    const secondResponse = await fetch(`${baseUrl}/api/draw`, init);
    const secondBody = (await secondResponse.json()) as { status: string; claimId: string };

    expect(firstResponse.status).toBe(201);
    expect(firstBody.status).toBe('SUCCESS');

    expect(secondResponse.status).toBe(200);
    expect(secondBody.status).toBe('ALREADY_CLAIMED');
    expect(secondBody.claimId).toBe(firstBody.claimId);
  });
});

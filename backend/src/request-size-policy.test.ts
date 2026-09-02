import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultNodeHandler } from './app.js';
import {
  REQUEST_BODY_SIZE_LIMIT_BYTES,
  REQUEST_TOO_LARGE_CODE,
  REQUEST_TOO_LARGE_MESSAGE,
  utf8ByteLength,
} from './request-size-policy.js';

interface DrawLikePayload {
  name: string;
  phone: string;
  billNumber: string;
  pad?: string;
}

const buildDrawBodyWithExactBytes = (targetBytes: number): string => {
  const payload: DrawLikePayload = {
    name: 'Arindam Roy',
    phone: '9876543210',
    billNumber: 'DB12345',
    pad: '',
  };

  const base = JSON.stringify(payload);
  const deficit = targetBytes - utf8ByteLength(base);
  if (deficit < 0) {
    throw new Error('Target size is smaller than baseline payload size.');
  }

  payload.pad = 'a'.repeat(deficit);
  let text = JSON.stringify(payload);

  const delta = targetBytes - utf8ByteLength(text);
  if (delta !== 0) {
    payload.pad = 'a'.repeat(Math.max(0, payload.pad.length + delta));
    text = JSON.stringify(payload);
  }

  if (utf8ByteLength(text) !== targetBytes) {
    throw new Error(`Could not build payload at exact target size ${targetBytes}.`);
  }

  return text;
};

const jsonHeaders = {
  'content-type': 'application/json',
};

describe('request-size policy enforcement (node application layer)', () => {
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

  const startServer = async (): Promise<string> => {
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
      throw new Error('Unable to resolve server address.');
    }

    return `http://127.0.0.1:${address.port}`;
  };

  it('accepts draw payload below limit', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/draw`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Arindam Roy',
        phone: '9876543210',
        billNumber: 'DB12345',
      }),
    });

    expect(response.status).toBe(201);
  });

  it('accepts draw payload exactly at limit and proceeds to normal processing path', async () => {
    const baseUrl = await startServer();
    const bodyText = buildDrawBodyWithExactBytes(REQUEST_BODY_SIZE_LIMIT_BYTES);

    const response = await fetch(`${baseUrl}/api/draw`, {
      method: 'POST',
      headers: jsonHeaders,
      body: bodyText,
    });

    expect(response.status).toBe(201);
    const parsed = (await response.json()) as { status: string };
    expect(parsed.status).toBe('SUCCESS');
  });

  it('rejects draw payload above limit with approved 413 error contract', async () => {
    const baseUrl = await startServer();
    const bodyText = buildDrawBodyWithExactBytes(REQUEST_BODY_SIZE_LIMIT_BYTES + 1);

    const response = await fetch(`${baseUrl}/api/draw`, {
      method: 'POST',
      headers: jsonHeaders,
      body: bodyText,
    });

    expect(response.status).toBe(413);
    const parsed = (await response.json()) as { status: string; code: string; message: string };
    expect(parsed).toEqual({
      status: 'ERROR',
      code: REQUEST_TOO_LARGE_CODE,
      message: REQUEST_TOO_LARGE_MESSAGE,
    });
  });

  it('preserves malformed JSON behavior below limit', async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/draw`, {
      method: 'POST',
      headers: jsonHeaders,
      body: '{"name":',
    });

    expect(response.status).toBe(400);
    const parsed = (await response.json()) as { code: string };
    expect(parsed.code).toBe('VALIDATION_ERROR');
  });

  it('enforces policy for in-scope admin mutation endpoint', async () => {
    const baseUrl = await startServer();
    const bodyText = buildDrawBodyWithExactBytes(REQUEST_BODY_SIZE_LIMIT_BYTES + 1);

    const response = await fetch(`${baseUrl}/api/admin/prizes`, {
      method: 'POST',
      headers: jsonHeaders,
      body: bodyText,
    });

    expect(response.status).toBe(413);
    const parsed = (await response.json()) as { code: string };
    expect(parsed.code).toBe(REQUEST_TOO_LARGE_CODE);
  });
});

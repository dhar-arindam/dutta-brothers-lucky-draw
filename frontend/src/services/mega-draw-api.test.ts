import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  drawNextMegaPrize,
  getMegaDraw,
  getMegaDrawStatus,
  resetMegaDraw,
  saveMegaDrawConfiguration,
} from './mega-draw-api';

const mockFetch = vi.fn();
const storage = new Map<string, string>();
const lifecycle = {
  reference: 'MD-2026-1',
  executionYear: 2026,
  status: 'IN_PROGRESS' as const,
  campaign: {
    id: 'festive-2026',
    fromDate: '2026-08-01',
    toDate: '2026-10-31',
    timezone: 'Asia/Kolkata' as const,
    ended: true as const,
  },
  prizes: [{ position: 1, name: 'Gold Coin' }],
  selectedRows: [
    {
      prize: { position: 1, name: 'Gold Coin' },
      candidate: {
        identity: 'BILL-1#9999912345',
        normalizedPhone: '9999912345',
        sourceClaimId: 'DB26-1',
        sourceClaimTimestamp: '2026-10-01T00:00:00.000Z',
        customerName: 'Amit Das',
        maskedPhone: '*****1234',
        billNumber: 'BILL-1',
      },
      selectedAt: '2026-12-01T12:00:00.000Z',
      candidatePoolCount: 4,
      sourceClaimStatus: 'ACTIVE' as const,
    },
  ],
  nextPrizeOrdinal: 2,
  remainingPrizes: [],
};

describe('mega draw api client', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    storage.clear();
  });

  it('uses the protected configuration and draw-next contracts', async () => {
    sessionStorage.setItem(
      'dutta-draw-admin-auth',
      JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000 }),
    );
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'SUCCESS', prizes: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'SUCCESS',
          lifecycle,
          selectedRow: lifecycle.selectedRows[0],
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    await saveMegaDrawConfiguration(['Gold Coin']);
    await drawNextMegaPrize(
      {
        preflightReference: 'MD-2026-0',
        acknowledgement: true,
        confirmation: 'DRAW NEXT MEGA PRIZE 2026',
      },
      'attempt-1',
    );

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/admin/mega-draw/configuration',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ prizes: ['Gold Coin'] }),
        headers: expect.objectContaining({ authorization: 'Bearer token' }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/admin/mega-draw/draw-next',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'attempt-1' }),
      }),
    );
  });

  it('preserves machine-readable backend errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        status: 'ERROR',
        code: 'PREFLIGHT_STALE',
        message: 'The Mega Draw preflight is no longer current.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(getMegaDraw()).rejects.toEqual(
      expect.objectContaining({ code: 'PREFLIGHT_STALE', statusCode: 409 }),
    );
  });

  it('uses the protected reset contract without an idempotency key', async () => {
    sessionStorage.setItem(
      'dutta-draw-admin-auth',
      JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000 }),
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'SUCCESS', executionYear: 2026 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      resetMegaDraw({ acknowledgement: true, confirmation: 'RESET MEGA DRAW 2026' }),
    ).resolves.toEqual({ status: 'SUCCESS', executionYear: 2026 });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/admin/mega-draw/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ acknowledgement: true, confirmation: 'RESET MEGA DRAW 2026' }),
        headers: expect.objectContaining({ authorization: 'Bearer token' }),
      }),
    );
  });

  it('looks up an attempt status and removes internal contact fields', async () => {
    sessionStorage.setItem(
      'dutta-draw-admin-auth',
      JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000 }),
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'SUCCESS',
        execution: 'COMPLETED',
        operation: 'DRAW_NEXT',
        lifecycle,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const response = await getMegaDrawStatus('attempt/key');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/admin/mega-draw/status/attempt%2Fkey',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token' }),
      }),
    );
    expect(response.lifecycle?.selectedRows[0]?.candidate).toEqual({
      sourceClaimId: 'DB26-1',
      sourceClaimTimestamp: '2026-10-01T00:00:00.000Z',
      customerName: 'Amit Das',
      maskedPhone: '*****1234',
      billNumber: 'BILL-1',
    });
  });
});

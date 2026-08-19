import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIdempotencyKey, DrawApiError, submitDraw } from './draw-api';

describe('draw api idempotency header behavior', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('includes Idempotency-Key header when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
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
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await submitDraw(
      {
        name: 'Arindam Roy',
        phone: '9876543210',
        billNumber: 'DB12345',
      },
      {
        idempotencyKey: 'key-1',
      },
    );

    const requestOptions = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(requestOptions.headers['idempotency-key']).toBe('key-1');
  });

  it('does not include Idempotency-Key header when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        status: 'ERROR',
        code: 'VALIDATION_ERROR',
        message: 'Please check the form and try again.',
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await submitDraw({
      name: 'Arindam Roy',
      phone: '9876543210',
      billNumber: 'DB12345',
    });

    const requestOptions = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(requestOptions.headers['idempotency-key']).toBeUndefined();
  });

  it('creates non-empty idempotency keys', () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => 'uuid-123');
    vi.stubGlobal('crypto', { randomUUID });

    expect(createIdempotencyKey()).toBe('uuid-123');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('throws API_ERROR when response shape is invalid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitDraw({
        name: 'Arindam Roy',
        phone: '9876543210',
        billNumber: 'DB12345',
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'DrawApiError', code: 'API_ERROR' }));
  });

  it('maps abort errors to network timeout message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitDraw({
        name: 'Arindam Roy',
        phone: '9876543210',
        billNumber: 'DB12345',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'DrawApiError',
        code: 'NETWORK_ERROR',
        message: 'The network is taking too long. Please check your connection and retry.',
      }),
    );
  });

  it('rethrows DrawApiError unchanged', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DrawApiError('upstream', 'API_ERROR'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitDraw({
        name: 'Arindam Roy',
        phone: '9876543210',
        billNumber: 'DB12345',
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'DrawApiError', code: 'API_ERROR', message: 'upstream' }));
  });

  it('maps generic fetch failures to NETWORK_ERROR', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hangup'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitDraw({
        name: 'Arindam Roy',
        phone: '9876543210',
        billNumber: 'DB12345',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'DrawApiError',
        code: 'NETWORK_ERROR',
        message: 'We could not complete the draw. Please check your connection and retry.',
      }),
    );
  });
});

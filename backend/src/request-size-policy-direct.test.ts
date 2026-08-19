import { describe, expect, it, vi } from 'vitest';

import {
  RequestBodyTooLargeError,
  isRequestSizePolicyEndpoint,
  logOversizedRequest,
  toRequestTooLargeBody,
  utf8ByteLength,
} from './request-size-policy.js';

describe('request-size policy helpers', () => {
  it('matches only intended policy routes', () => {
    expect(isRequestSizePolicyEndpoint('POST', '/api/draw')).toBe(true);
    expect(isRequestSizePolicyEndpoint('POST', '/api/admin/prizes')).toBe(true);
    expect(isRequestSizePolicyEndpoint('PATCH', '/api/admin/prizes/prize-001')).toBe(true);
    expect(isRequestSizePolicyEndpoint('PATCH', '/api/admin/campaign')).toBe(true);
    expect(isRequestSizePolicyEndpoint('GET', '/api/draw')).toBe(false);
    expect(isRequestSizePolicyEndpoint('PATCH', '/api/admin/prizes')).toBe(false);
    expect(isRequestSizePolicyEndpoint('PATCH', '/api/admin/prizes/a/b')).toBe(false);
  });

  it('creates request-too-large response and calculates utf8 byte length', () => {
    const body = toRequestTooLargeBody();

    expect(body.code).toBe('REQUEST_TOO_LARGE');
    expect(body.status).toBe('ERROR');
    expect(utf8ByteLength(undefined)).toBe(0);
    expect(utf8ByteLength('₹')).toBeGreaterThan(1);
  });

  it('emits structured warning log and keeps observed bytes on error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const error = new RequestBodyTooLargeError(40000);
    expect(error.observedBytes).toBe(40000);

    logOversizedRequest({
      layer: 'node',
      method: 'POST',
      path: '/api/draw',
      observedBytes: 40000,
      requestId: 'req-1',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('REQUEST_TOO_LARGE_REJECTED');
  });
});

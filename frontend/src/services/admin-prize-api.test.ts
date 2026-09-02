import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminApiError,
  addAdminPrize,
  exportAdminClaimsCsv,
  getAdminCampaign,
  getAdminSummary,
  listAdminClaims,
  listAdminPrizes,
  patchAdminCampaign,
  patchAdminPrize,
} from './admin-prize-api';

const mockFetch = vi.fn();

describe('admin prize api client', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists prizes and applies default json headers', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'SUCCESS', items: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await listAdminPrizes();

    expect(response.status).toBe('SUCCESS');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/admin/prizes',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'content-type': 'application/json',
        }),
      }),
    );
  });

  it('adds and updates prize using expected endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({ status: 'SUCCESS', item: { id: 'prize-004' } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ status: 'SUCCESS', item: { id: 'prize-004' } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const created = await addAdminPrize({ name: 'Mixer', weight: 3, active: true });
    const updated = await patchAdminPrize('prize 004', { weight: 7, active: false });

    expect(created.status).toBe('SUCCESS');
    expect(updated.status).toBe('SUCCESS');
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/admin/prizes/prize%20004',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('builds claims query string from filters', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'SUCCESS', items: [], nextPageToken: null }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await listAdminClaims({
      pageSize: 50,
      pageToken: 'token1',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      prizeId: 'prize-001',
      search: 'Amit',
    });

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/admin/claims?');
    expect(calledUrl).toContain('pageSize=50');
    expect(calledUrl).toContain('pageToken=token1');
    expect(calledUrl).toContain('prizeId=prize-001');
    expect(calledUrl).toContain('search=Amit');
  });

  it('gets and patches campaign', async () => {
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({ status: 'SUCCESS', campaign: { id: 'festive' } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ status: 'SUCCESS', campaign: { id: 'festive' } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const current = await getAdminCampaign();
    const updated = await patchAdminCampaign({ fromDate: '2026-09-01', toDate: '2026-12-01' });

    expect(current.status).toBe('SUCCESS');
    expect(updated.status).toBe('SUCCESS');
  });

  it('gets summary and exports csv', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 'SUCCESS', totalSuccessfulSpins: 4 }) })
      .mockResolvedValueOnce({ ok: true, text: async () => 'a,b,c' });
    vi.stubGlobal('fetch', mockFetch);

    const summary = await getAdminSummary();
    const csv = await exportAdminClaimsCsv(2026);

    expect(summary.status).toBe('SUCCESS');
    expect(csv).toBe('a,b,c');
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/admin/claims.csv?year=2026',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws AdminApiError on invalid response shape', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    await expect(listAdminPrizes()).rejects.toBeInstanceOf(AdminApiError);
  });

  it('throws AdminApiError for failed csv export response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'error' });
    vi.stubGlobal('fetch', mockFetch);

    await expect(exportAdminClaimsCsv(2026)).rejects.toBeInstanceOf(AdminApiError);
  });
});

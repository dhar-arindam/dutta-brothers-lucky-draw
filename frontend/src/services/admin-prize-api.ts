import type {
  AdminCampaignResponse,
  AdminClaimDeleteResponse,
  AdminClaimsClearResponse,
  AdminClaimsListResponse,
  AdminErrorResponse,
  AdminPrizeItemResponse,
  AdminPrizesListResponse,
  AdminPrizeResponse,
  AdminSummaryResponse,
} from '../types';

export class AdminApiError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

const REQUEST_TIMEOUT_MS = 8000;

const request = async (
  path: string,
  init: RequestInit,
): Promise<AdminPrizeResponse> => {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: abortController.signal,
    });

    const body = (await response.json()) as Partial<AdminPrizeResponse>;
    if (!body || typeof body !== 'object' || typeof body.status !== 'string') {
      throw new AdminApiError('Invalid response shape.');
    }

    return body as AdminPrizeResponse;
  } catch {
    throw new AdminApiError('We could not complete the admin request. Please try again.');
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const requestText = async (
  path: string,
  init: RequestInit,
): Promise<string> => {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      ...init,
      headers: init.headers,
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new AdminApiError('We could not complete the admin request. Please try again.');
    }

    return response.text();
  } catch {
    throw new AdminApiError('We could not complete the admin request. Please try again.');
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const listAdminPrizes = async (
): Promise<AdminPrizesListResponse | AdminErrorResponse> => {
  const response = await request('/api/admin/prizes', { method: 'GET' });
  return response as AdminPrizesListResponse | AdminErrorResponse;
};

export const addAdminPrize = async (
  payload: { name: string; weight: number; active: boolean },
): Promise<AdminPrizeItemResponse | AdminErrorResponse> => {
  const response = await request(
    '/api/admin/prizes',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return response as AdminPrizeItemResponse | AdminErrorResponse;
};

export const patchAdminPrize = async (
  prizeId: string,
  payload: { weight?: number; active?: boolean },
): Promise<AdminPrizeItemResponse | AdminErrorResponse> => {
  const response = await request(
    `/api/admin/prizes/${encodeURIComponent(prizeId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  return response as AdminPrizeItemResponse | AdminErrorResponse;
};

export interface AdminClaimsQuery {
  pageSize?: number;
  pageToken?: string;
  from?: string;
  to?: string;
  prizeId?: string;
  search?: string;
}

const buildClaimsQuery = (query: AdminClaimsQuery): string => {
  const params = new URLSearchParams();

  if (query.pageSize !== undefined) {
    params.set('pageSize', String(query.pageSize));
  }
  if (query.pageToken) {
    params.set('pageToken', query.pageToken);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.prizeId) {
    params.set('prizeId', query.prizeId);
  }
  if (query.search) {
    params.set('search', query.search);
  }

  const text = params.toString();
  return text ? `?${text}` : '';
};

export const listAdminClaims = async (
  query: AdminClaimsQuery,
): Promise<AdminClaimsListResponse | AdminErrorResponse> => {
  const response = await request(`/api/admin/claims${buildClaimsQuery(query)}`, { method: 'GET' });
  return response as AdminClaimsListResponse | AdminErrorResponse;
};

export const deleteAdminClaim = async (
  claimId: string,
): Promise<AdminClaimDeleteResponse | AdminErrorResponse> => {
  const response = await request(`/api/admin/claims/${encodeURIComponent(claimId)}`, { method: 'DELETE' });
  return response as AdminClaimDeleteResponse | AdminErrorResponse;
};

export const clearAdminClaims = async (
): Promise<AdminClaimsClearResponse | AdminErrorResponse> => {
  const response = await request('/api/admin/claims', { method: 'DELETE' });
  return response as AdminClaimsClearResponse | AdminErrorResponse;
};

export const getAdminSummary = async (
): Promise<AdminSummaryResponse | AdminErrorResponse> => {
  const response = await request('/api/admin/summary', { method: 'GET' });
  return response as AdminSummaryResponse | AdminErrorResponse;
};

export const getAdminCampaign = async (
): Promise<AdminCampaignResponse | AdminErrorResponse> => {
  const response = await request('/api/admin/campaign', { method: 'GET' });
  return response as AdminCampaignResponse | AdminErrorResponse;
};

export const patchAdminCampaign = async (
  payload: { fromDate?: string; toDate?: string },
): Promise<AdminCampaignResponse | AdminErrorResponse> => {
  const response = await request(
    '/api/admin/campaign',
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  return response as AdminCampaignResponse | AdminErrorResponse;
};

export const exportAdminClaimsCsv = async (
  query: AdminClaimsQuery,
): Promise<string> => {
  return requestText(`/api/admin/claims.csv${buildClaimsQuery(query)}`, { method: 'GET' });
};

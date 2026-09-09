import type {
  MegaDrawCloseResponse,
  MegaDrawConfigurationResponse,
  MegaDrawDrawNextResponse,
  MegaDrawErrorResponse,
  MegaDrawGetResponse,
  MegaDrawLifecycle,
  MegaDrawPreflightResponse,
  MegaDrawResetResponse,
  MegaDrawReopenResponse,
  MegaDrawStatusResponse,
} from '../types';
import { expireAdminSession, getAdminAccessToken } from './cognito-auth';

const REQUEST_TIMEOUT_MS = 8000;

export class MegaDrawApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'MegaDrawApiError';
  }
}

const toPublicLifecycle = (lifecycle: MegaDrawLifecycle): MegaDrawLifecycle => ({
  ...lifecycle,
  selectedRows: lifecycle.selectedRows.map((row) => ({
    ...row,
    candidate: {
      sourceClaimId: row.candidate.sourceClaimId,
      sourceClaimTimestamp: row.candidate.sourceClaimTimestamp,
      customerName: row.candidate.customerName,
      normalizedPhone: row.candidate.normalizedPhone,
      maskedPhone: row.candidate.maskedPhone,
      billNumber: row.candidate.billNumber,
    },
  })),
});

const request = async <T>(path: string, init: RequestInit): Promise<T> => {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const accessToken = getAdminAccessToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      signal: abortController.signal,
    });
    const body = (await response.json()) as Partial<MegaDrawErrorResponse>;

    if (!response.ok || body.status === 'ERROR') {
      if (response.status === 401) {
        expireAdminSession();
      }
      throw new MegaDrawApiError(
        typeof body.message === 'string'
          ? body.message
          : 'We could not complete the Mega Draw request.',
        response.status,
        typeof body.code === 'string' ? body.code : undefined,
      );
    }
    if (body.status !== 'SUCCESS') {
      throw new MegaDrawApiError('Invalid Mega Draw response shape.', response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof MegaDrawApiError) {
      throw error;
    }
    throw new MegaDrawApiError('We could not complete the Mega Draw request. Please try again.');
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const getMegaDraw = async (): Promise<MegaDrawGetResponse> => {
  const response = await request<MegaDrawGetResponse>('/api/admin/mega-draw', { method: 'GET' });
  return {
    ...response,
    ...(response.lifecycle ? { lifecycle: toPublicLifecycle(response.lifecycle) } : {}),
  };
};

export const saveMegaDrawConfiguration = (
  prizes: string[],
): Promise<MegaDrawConfigurationResponse> =>
  request('/api/admin/mega-draw/configuration', {
    method: 'PUT',
    body: JSON.stringify({ prizes }),
  });

export const prepareMegaDraw = (): Promise<MegaDrawPreflightResponse> =>
  request('/api/admin/mega-draw/preflight', { method: 'POST' });

export const drawNextMegaPrize = async (
  payload: { preflightReference?: string },
  idempotencyKey: string,
): Promise<MegaDrawDrawNextResponse> => {
  const response = await request<MegaDrawDrawNextResponse>('/api/admin/mega-draw/draw-next', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
  return { ...response, lifecycle: toPublicLifecycle(response.lifecycle) };
};

export const resetMegaDraw = (payload: {
  acknowledgement: boolean;
  confirmation: string;
}): Promise<MegaDrawResetResponse> =>
  request('/api/admin/mega-draw/reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const closeMegaDraw = (payload: {
  acknowledgement: boolean;
  confirmation: string;
}): Promise<MegaDrawCloseResponse> =>
  request('/api/admin/mega-draw/close', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const reopenMegaDraw = (): Promise<MegaDrawReopenResponse> =>
  request('/api/admin/mega-draw/reopen', { method: 'POST' });

export const getMegaDrawStatus = async (
  idempotencyKey: string,
): Promise<MegaDrawStatusResponse> => {
  const response = await request<MegaDrawStatusResponse>(
    `/api/admin/mega-draw/status/${encodeURIComponent(idempotencyKey)}`,
    { method: 'GET' },
  );
  return {
    ...response,
    ...(response.lifecycle ? { lifecycle: toPublicLifecycle(response.lifecycle) } : {}),
  };
};

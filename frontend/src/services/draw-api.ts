import type { DrawRequest, DrawResponse } from '../types';

export class DrawApiError extends Error {
  public readonly code: 'API_ERROR' | 'NETWORK_ERROR';

  public constructor(message: string, code: 'API_ERROR' | 'NETWORK_ERROR') {
    super(message);
    this.name = 'DrawApiError';
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 8000;

export interface SubmitDrawOptions {
  idempotencyKey?: string;
}

export const createIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const submitDraw = async (
  payload: DrawRequest,
  options: SubmitDrawOptions = {},
): Promise<DrawResponse> => {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('/api/draw', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.idempotencyKey
          ? {
              'idempotency-key': options.idempotencyKey,
            }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    const parsed = (await response.json()) as Partial<DrawResponse>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.status !== 'string') {
      throw new DrawApiError('Invalid response shape.', 'API_ERROR');
    }

    return parsed as DrawResponse;
  } catch (error) {
    if (error instanceof DrawApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DrawApiError(
        'The network is taking too long. Please check your connection and retry.',
        'NETWORK_ERROR',
      );
    }

    throw new DrawApiError(
      'We could not complete the draw. Please check your connection and retry.',
      'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
};

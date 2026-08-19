export const REQUEST_BODY_SIZE_LIMIT_BYTES = 32 * 1024;

export const REQUEST_TOO_LARGE_CODE = 'REQUEST_TOO_LARGE';

export const REQUEST_TOO_LARGE_MESSAGE =
  'Request body exceeds the maximum allowed size. Please reduce request size and try again.';

export interface RequestTooLargeBody {
  status: 'ERROR';
  code: typeof REQUEST_TOO_LARGE_CODE;
  message: typeof REQUEST_TOO_LARGE_MESSAGE;
}

export class RequestBodyTooLargeError extends Error {
  public readonly observedBytes: number;

  public constructor(observedBytes: number) {
    super('Request body exceeds configured request-size policy limit.');
    this.name = 'RequestBodyTooLargeError';
    this.observedBytes = observedBytes;
  }
}

export const isRequestSizePolicyEndpoint = (method: string, path: string): boolean => {
  if (method === 'POST' && path === '/api/draw') {
    return true;
  }

  if (method === 'POST' && path === '/api/admin/prizes') {
    return true;
  }

  if (method === 'PATCH' && /^\/api\/admin\/prizes\/[^/]+$/.test(path)) {
    return true;
  }

  if (method === 'PATCH' && path === '/api/admin/campaign') {
    return true;
  }

  return false;
};

export const toRequestTooLargeBody = (): RequestTooLargeBody => {
  return {
    status: 'ERROR',
    code: REQUEST_TOO_LARGE_CODE,
    message: REQUEST_TOO_LARGE_MESSAGE,
  };
};

export const utf8ByteLength = (text: string | undefined): number => {
  return Buffer.byteLength(text ?? '', 'utf8');
};

export const logOversizedRequest = (input: {
  layer: 'node' | 'lambda';
  method: string;
  path: string;
  observedBytes: number;
  requestId?: string;
}): void => {
  const payload = {
    event: 'REQUEST_TOO_LARGE_REJECTED',
    layer: input.layer,
    method: input.method,
    path: input.path,
    observedBytes: input.observedBytes,
    requestId: input.requestId,
  };

  console.warn(JSON.stringify(payload));
};

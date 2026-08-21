import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminCsvResponse,
  AdminHttpResponse,
  DrawHttpResponse,
  DrawRequest,
} from './contracts.js';
import { createDefaultDrawService, DrawService } from './draw-service.js';
import {
  type AdminClaimsQuery,
  type CampaignUpdateInput,
  InMemoryDrawStore,
  UpdatePrizeInput,
} from './store.js';
import {
  isRequestSizePolicyEndpoint,
  logOversizedRequest,
  REQUEST_BODY_SIZE_LIMIT_BYTES,
  RequestBodyTooLargeError,
  toRequestTooLargeBody,
  utf8ByteLength,
} from './request-size-policy.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
};

export interface DrawApiHandler {
  handle(
    bodyText: string,
    context?: {
      idempotencyKey?: string;
    },
  ): DrawHttpResponse;
}

export interface AdminPrizeApiHandler {
  listPrizes(): AdminHttpResponse;
  addPrize(bodyText: string): AdminHttpResponse;
  updatePrize(prizeId: string, bodyText: string): AdminHttpResponse;
  listClaims(query: URLSearchParams): AdminHttpResponse;
  deleteClaim(claimId: string): AdminHttpResponse;
  clearAllClaims(): AdminHttpResponse;
  exportClaimsCsv(query: URLSearchParams): AdminCsvResponse;
  getSummary(): AdminHttpResponse;
  getCampaign(): AdminHttpResponse;
  updateCampaign(bodyText: string): AdminHttpResponse;
}

export const createDrawApiHandler = (drawService: DrawService): DrawApiHandler => {
  return {
    handle(bodyText: string): DrawHttpResponse {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        return {
          statusCode: 400,
          body: {
            status: 'ERROR',
            code: 'VALIDATION_ERROR',
            message: 'Please check the form and try again.',
          },
        };
      }

      if (!isDrawRequest(parsedBody)) {
        return {
          statusCode: 400,
          body: {
            status: 'ERROR',
            code: 'VALIDATION_ERROR',
            message: 'Please check the form and try again.',
          },
        };
      }

      try {
        return drawService.execute(parsedBody);
      } catch {
        return {
          statusCode: 500,
          body: {
            status: 'ERROR',
            code: 'INTERNAL_ERROR',
            message: 'We could not complete the draw. Please try again.',
          },
        };
      }
    },
  };
};

export const createAdminPrizeApiHandler = (
  store: InMemoryDrawStore,
): AdminPrizeApiHandler => {
  return {
    listPrizes(): AdminHttpResponse {
      const distributionByPrizeId = new Map(
        store.summary().prizeDistribution.map((item) => [item.prizeId, item.givenCount]),
      );

      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          items: store.listAllPrizes().map((prize) => ({
            id: prize.id,
            name: prize.name,
            weight: prize.weight,
            active: prize.active,
            givenCount: distributionByPrizeId.get(prize.id) ?? 0,
            createdAt: prize.createdAt,
            updatedAt: prize.updatedAt,
          })),
        },
      };
    },

    addPrize(bodyText: string): AdminHttpResponse {
      const parsed = safeParseJson(bodyText);
      if (!parsed.ok || !isCreatePrizeRequest(parsed.value)) {
        return validationErrorResponse();
      }

      const result = store.addPrize(parsed.value);
      if (result.type === 'VALIDATION_ERROR') {
        const errorBody = {
          status: 'ERROR' as const,
          code: 'VALIDATION_ERROR' as const,
          message: result.message,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        };

        return {
          statusCode: 400,
          body: errorBody,
        };
      }

      if (result.type !== 'SUCCESS') {
        return internalErrorResponse();
      }

      return {
        statusCode: 201,
        body: {
          status: 'SUCCESS',
          item: {
            id: result.prize.id,
            name: result.prize.name,
            weight: result.prize.weight,
            active: result.prize.active,
            givenCount: store.summary().prizeDistribution.find((item) => item.prizeId === result.prize.id)?.givenCount ?? 0,
            createdAt: result.prize.createdAt,
            updatedAt: result.prize.updatedAt,
          },
        },
      };
    },

    updatePrize(prizeId: string, bodyText: string): AdminHttpResponse {
      const parsed = safeParseJson(bodyText);
      if (!parsed.ok || !isUpdatePrizeRequest(parsed.value)) {
        return validationErrorResponse();
      }

      const result = store.updatePrize(prizeId, parsed.value);
      if (result.type === 'NOT_FOUND') {
        return validationErrorResponse('Prize was not found.');
      }

      if (result.type === 'VALIDATION_ERROR') {
        const errorBody = {
          status: 'ERROR' as const,
          code: 'VALIDATION_ERROR' as const,
          message: result.message,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        };

        return {
          statusCode: 400,
          body: errorBody,
        };
      }

      if (result.type !== 'SUCCESS') {
        return internalErrorResponse();
      }

      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          item: {
            id: result.prize.id,
            name: result.prize.name,
            weight: result.prize.weight,
            active: result.prize.active,
            givenCount: store.summary().prizeDistribution.find((item) => item.prizeId === result.prize.id)?.givenCount ?? 0,
            createdAt: result.prize.createdAt,
            updatedAt: result.prize.updatedAt,
          },
        },
      };
    },

    listClaims(query: URLSearchParams): AdminHttpResponse {
      const parsedQuery = parseClaimsQuery(query);
      if (!parsedQuery.ok) {
        return {
          statusCode: 400,
          body: {
            status: 'ERROR',
            code: 'VALIDATION_ERROR',
            message: 'Please check the form and try again.',
            fieldErrors: parsedQuery.fieldErrors,
          },
        };
      }

      const result = store.listAdminClaims(parsedQuery.value);
      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          items: result.items,
          nextPageToken: result.nextPageToken,
        },
      };
    },

    exportClaimsCsv(query: URLSearchParams): AdminCsvResponse {
      void query;
      const result = store.listAdminClaimsForCsv();
      const rows = [
        ['date/time', 'claim ID', 'customer name', 'bill number', 'prize', 'phone'],
        ...result.map((item) => [
          item.claimTimestamp,
          item.claimId,
          item.customerName,
          item.billNumber,
          item.prize,
          item.phone,
        ]),
      ];

      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="claims.csv"',
        },
        body: rows.map((row) => row.map(toCsvCell).join(',')).join('\n'),
      };
    },

    deleteClaim(claimId: string): AdminHttpResponse {
      const result = store.deleteClaim(claimId);
      if (result.type === 'NOT_FOUND') {
        return validationErrorResponse('Claim was not found.');
      }

      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
        },
      };
    },

    clearAllClaims(): AdminHttpResponse {
      const deletedCount = store.clearAllClaims();
      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          deletedCount,
        },
      };
    },

    getSummary(): AdminHttpResponse {
      const summary = store.summary();
      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          totalSuccessfulSpins: summary.totalSuccessfulSpins,
          today: summary.today,
          prizeDistribution: summary.prizeDistribution,
        },
      };
    },

    getCampaign(): AdminHttpResponse {
      const campaign = store.getCampaign();
      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          campaign,
        },
      };
    },

    updateCampaign(bodyText: string): AdminHttpResponse {
      const parsed = safeParseJson(bodyText);
      if (!parsed.ok || !isCampaignUpdateRequest(parsed.value)) {
        return validationErrorResponse();
      }

      const result = store.updateCampaign(parsed.value);
      if (result.type === 'VALIDATION_ERROR') {
        return {
          statusCode: 400,
          body: {
            status: 'ERROR',
            code: 'VALIDATION_ERROR',
            message: result.message,
            fieldErrors: result.fieldErrors,
          },
        };
      }

      return {
        statusCode: 200,
        body: {
          status: 'SUCCESS',
          campaign: {
            ...result.campaign,
            status: store.getCampaign().status,
          },
        },
      };
    },
  };
};

const isDrawRequest = (value: unknown): value is DrawRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    typeof data.name === 'string' &&
    typeof data.phone === 'string' &&
    typeof data.billNumber === 'string'
  );
};

interface CreatePrizeRequest {
  name: string;
  weight: number;
  active: boolean;
}

const isCreatePrizeRequest = (value: unknown): value is CreatePrizeRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    typeof data.name === 'string' &&
    typeof data.weight === 'number' &&
    typeof data.active === 'boolean'
  );
};

const isUpdatePrizeRequest = (value: unknown): value is UpdatePrizeInput => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Record<string, unknown>;
  const hasWeight = Object.hasOwn(data, 'weight');
  const hasActive = Object.hasOwn(data, 'active');

  if (!hasWeight && !hasActive) {
    return false;
  }

  if (hasWeight && typeof data.weight !== 'number') {
    return false;
  }

  if (hasActive && typeof data.active !== 'boolean') {
    return false;
  }

  return true;
};

const isCampaignUpdateRequest = (value: unknown): value is CampaignUpdateInput => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Record<string, unknown>;
  const hasFromDate = Object.hasOwn(data, 'fromDate');
  const hasToDate = Object.hasOwn(data, 'toDate');

  if (!hasFromDate && !hasToDate) {
    return false;
  }

  if (hasFromDate && typeof data.fromDate !== 'string') {
    return false;
  }
  if (hasToDate && typeof data.toDate !== 'string') {
    return false;
  }

  return true;
};

const safeParseJson = (value: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return {
      ok: true,
      value: JSON.parse(value),
    };
  } catch {
    return {
      ok: false,
    };
  }
};

const validationErrorResponse = (
  message = 'Please check the form and try again.',
): AdminHttpResponse => {
  return {
    statusCode: 400,
    body: {
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      message,
    },
  };
};

const internalErrorResponse = (): AdminHttpResponse => {
  return {
    statusCode: 500,
    body: {
      status: 'ERROR',
      code: 'INTERNAL_ERROR',
      message: 'We could not complete the draw. Please try again.',
    },
  };
};

const parseClaimsQuery = (
  query: URLSearchParams,
):
  | {
      ok: true;
      value: AdminClaimsQuery;
    }
  | {
      ok: false;
      fieldErrors: Partial<Record<'pageSize' | 'from' | 'to', string>>;
    } => {
  const fieldErrors: Partial<Record<'pageSize' | 'from' | 'to', string>> = {};
  const pageSizeRaw = query.get('pageSize');
  const pageSize = pageSizeRaw === null ? undefined : Number(pageSizeRaw);

  if (
    pageSizeRaw !== null &&
    (pageSize === undefined || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 150)
  ) {
    fieldErrors.pageSize = 'Page size must be an integer between 1 and 150.';
  }

  const from = query.get('from') ?? undefined;
  const to = query.get('to') ?? undefined;
  if (from && Number.isNaN(Date.parse(from))) {
    fieldErrors.from = 'From must be a valid ISO 8601 UTC timestamp.';
  }
  if (to && Number.isNaN(Date.parse(to))) {
    fieldErrors.to = 'To must be a valid ISO 8601 UTC timestamp.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      fieldErrors,
    };
  }

  const value: AdminClaimsQuery = {};

  const pageToken = query.get('pageToken');
  const prizeId = query.get('prizeId');
  const search = query.get('search');

  if (pageToken !== null && pageToken.trim().length > 0) {
    value.pageToken = pageToken;
  }
  if (from !== undefined) {
    value.from = from;
  }
  if (to !== undefined) {
    value.to = to;
  }
  if (prizeId !== null && prizeId.trim().length > 0) {
    value.prizeId = prizeId;
  }
  if (search !== null && search.trim().length > 0) {
    value.search = search;
  }

  if (pageSize !== undefined) {
    value.pageSize = pageSize;
  }

  return {
    ok: true,
    value,
  };
};

const toCsvCell = (raw: string): string => {
  let value = raw;
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }

  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
};

interface NodeHandlers {
  drawApiHandler: DrawApiHandler;
  adminPrizeApiHandler: AdminPrizeApiHandler;
}

export const createDefaultNodeHandler = () => {
  const store = new InMemoryDrawStore();
  const drawService = createDefaultDrawService(store);
  const drawApiHandler = createDrawApiHandler(drawService);
  const adminPrizeApiHandler = createAdminPrizeApiHandler(store);

  return createNodeHandler({
    drawApiHandler,
    adminPrizeApiHandler,
  });
};

export const createNodeHandler = (handlers: NodeHandlers) => {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const requestId = readRequestIdHeader(req);

    const readBodyForRoute = async (): Promise<string> => {
      const enforceLimit = isRequestSizePolicyEndpoint(method, parsedUrl.pathname);

      try {
        return await readBody(req, enforceLimit ? REQUEST_BODY_SIZE_LIMIT_BYTES : undefined);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          const oversizedRequestLogContext = requestId
            ? {
                requestId,
              }
            : {};

          logOversizedRequest({
            layer: 'node',
            method,
            path: parsedUrl.pathname,
            observedBytes: error.observedBytes,
            ...oversizedRequestLogContext,
          });

          res.writeHead(413, jsonHeaders);
          res.end(JSON.stringify(toRequestTooLargeBody()));
          throw error;
        }

        throw error;
      }
    };

    if (method === 'POST' && parsedUrl.pathname === '/api/draw') {
      let bodyText = '';
      try {
        bodyText = await readBodyForRoute();
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return;
        }
        throw error;
      }

      const idempotencyKeyHeader = readIdempotencyKeyHeader(req);
      const drawContext = idempotencyKeyHeader
        ? {
            idempotencyKey: idempotencyKeyHeader,
          }
        : undefined;
      const response = handlers.drawApiHandler.handle(bodyText, drawContext);
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'GET' && parsedUrl.pathname === '/api/admin/prizes') {
      const response = handlers.adminPrizeApiHandler.listPrizes();
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'POST' && parsedUrl.pathname === '/api/admin/prizes') {
      let bodyText = '';
      try {
        bodyText = await readBodyForRoute();
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return;
        }
        throw error;
      }

      const response = handlers.adminPrizeApiHandler.addPrize(bodyText);
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    const prizeUpdateMatch = parsedUrl.pathname.match(/^\/api\/admin\/prizes\/([^/]+)$/);
    if (method === 'PATCH' && prizeUpdateMatch) {
      const rawPrizeId = prizeUpdateMatch[1];
      if (!rawPrizeId) {
        const response = validationErrorResponse();
        res.writeHead(response.statusCode, jsonHeaders);
        res.end(JSON.stringify(response.body));
        return;
      }

      const prizeId = decodeURIComponent(rawPrizeId);
      let bodyText = '';
      try {
        bodyText = await readBodyForRoute();
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return;
        }
        throw error;
      }

      const response = handlers.adminPrizeApiHandler.updatePrize(prizeId, bodyText);
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'GET' && parsedUrl.pathname === '/api/admin/claims') {
      const response = handlers.adminPrizeApiHandler.listClaims(parsedUrl.searchParams);
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'GET' && parsedUrl.pathname === '/api/admin/claims.csv') {
      const response = handlers.adminPrizeApiHandler.exportClaimsCsv(parsedUrl.searchParams);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
      return;
    }

    const claimDeleteMatch = parsedUrl.pathname.match(/^\/api\/admin\/claims\/([^/]+)$/);
    if (method === 'DELETE' && claimDeleteMatch) {
      const rawClaimId = claimDeleteMatch[1];
      if (!rawClaimId) {
        const response = validationErrorResponse();
        res.writeHead(response.statusCode, jsonHeaders);
        res.end(JSON.stringify(response.body));
        return;
      }

      const claimId = decodeURIComponent(rawClaimId);
      const response = handlers.adminPrizeApiHandler.deleteClaim(claimId);
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'DELETE' && parsedUrl.pathname === '/api/admin/claims') {
      const response = handlers.adminPrizeApiHandler.clearAllClaims();
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'GET' && parsedUrl.pathname === '/api/admin/summary') {
      const response = handlers.adminPrizeApiHandler.getSummary();
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'GET' && parsedUrl.pathname === '/api/admin/campaign') {
      const response = handlers.adminPrizeApiHandler.getCampaign();
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    if (method === 'PATCH' && parsedUrl.pathname === '/api/admin/campaign') {
      let bodyText = '';
      try {
        bodyText = await readBodyForRoute();
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return;
        }
        throw error;
      }

      const response = handlers.adminPrizeApiHandler.updateCampaign(bodyText);
      res.writeHead(response.statusCode, jsonHeaders);
      res.end(JSON.stringify(response.body));
      return;
    }

    res.writeHead(404, jsonHeaders);
    res.end(
      JSON.stringify({
        status: 'ERROR',
        code: 'INTERNAL_ERROR',
        message: 'Route not found.',
      }),
    );
  };
};

const readBody = async (req: IncomingMessage, maxBytes?: number): Promise<string> => {
  const chunks: string[] = [];
  let observedBytes = 0;

  for await (const chunk of req) {
    const text = chunk.toString();
    observedBytes += utf8ByteLength(text);

    if (maxBytes !== undefined && observedBytes > maxBytes) {
      throw new RequestBodyTooLargeError(observedBytes);
    }

    chunks.push(text);
  }

  return chunks.join('');
};

const readIdempotencyKeyHeader = (req: IncomingMessage): string | undefined => {
  const header = req.headers['idempotency-key'];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
};

const readRequestIdHeader = (req: IncomingMessage): string | undefined => {
  const header = req.headers['x-request-id'];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
};

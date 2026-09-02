import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { isCampaignActive } from './campaign.js';
import type {
  AdminCsvResponse,
  AdminErrorResponse,
  AdminHttpResponse,
  DrawErrorResponse,
  DrawRequest,
  DrawResponse,
  DrawSuccessResponse,
} from './contracts.js';
import { DynamoDbDrawStore } from './durable-dynamodb-store.js';
import { selectWeightedPrize } from './prize-selection.js';
import {
  isRequestSizePolicyEndpoint,
  logOversizedRequest,
  REQUEST_BODY_SIZE_LIMIT_BYTES,
  toRequestTooLargeBody,
  utf8ByteLength,
} from './request-size-policy.js';
import { CsvExportTooLargeError } from './store.js';
import { validateDrawRequest } from './validation.js';
import { resolveRuntimeMode } from './runtime-mode.js';

const runtimeMode = resolveRuntimeMode(process.env.APP_RUNTIME);
if (runtimeMode !== 'PRODUCTION') {
  throw new Error('Lambda runtime requires APP_RUNTIME=PRODUCTION.');
}

const tableName = process.env.DRAWS_TABLE_NAME;
if (!tableName) {
  throw new Error('DRAWS_TABLE_NAME environment variable is required.');
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const store = new DynamoDbDrawStore(docClient, { tableName });

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
};

const now = (): Date => new Date();

const validationErrorResponse = (
  message = 'Please check the form and try again.',
  fieldErrors?: AdminErrorResponse['fieldErrors'],
): AdminHttpResponse => {
  const body: AdminErrorResponse = {
    status: 'ERROR',
    code: 'VALIDATION_ERROR',
    message,
  };

  if (fieldErrors) {
    body.fieldErrors = fieldErrors;
  }

  return {
    statusCode: 400,
    body,
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

const drawInternalErrorResponse = (): { statusCode: 500; body: DrawErrorResponse } => {
  return {
    statusCode: 500,
    body: {
      status: 'ERROR',
      code: 'INTERNAL_ERROR',
      message: 'We could not complete the draw. Please try again.',
    },
  };
};

const readIdempotencyKeyHeader = (
  headers: Record<string, string | undefined> | undefined,
): string | undefined => {
  if (!headers) {
    return undefined;
  }

  const direct = headers['idempotency-key'];
  if (direct) {
    return direct;
  }

  const matched = Object.entries(headers).find(([key]) => key.toLowerCase() === 'idempotency-key');
  return matched?.[1];
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

const isCreatePrizeRequest = (
  value: unknown,
): value is { name: string; weight: number; active: boolean } => {
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

const isUpdatePrizeRequest = (value: unknown): value is { weight?: number; active?: boolean } => {
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

const isCampaignUpdateRequest = (
  value: unknown,
): value is { fromDate?: string; toDate?: string } => {
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

const safeParseJson = (value: string | undefined): { ok: true; value: unknown } | { ok: false } => {
  if (!value) {
    return { ok: false };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value),
    };
  } catch {
    return { ok: false };
  }
};

const parseClaimsQuery = (
  query: URLSearchParams,
):
  | {
      ok: true;
      value: {
        pageSize?: number;
        pageToken?: string;
        from?: string;
        to?: string;
        prizeId?: string;
        search?: string;
      };
    }
  | { ok: false; fieldErrors: Partial<Record<'pageSize' | 'from' | 'to', string>> } => {
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

  const pageToken = query.get('pageToken');
  const prizeId = query.get('prizeId');
  const search = query.get('search');

  const value: {
    pageSize?: number;
    pageToken?: string;
    from?: string;
    to?: string;
    prizeId?: string;
    search?: string;
  } = {};

  if (pageSize !== undefined) {
    value.pageSize = pageSize;
  }
  if (pageToken !== null && pageToken.trim().length > 0) {
    value.pageToken = pageToken;
  }
  if (from) {
    value.from = from;
  }
  if (to) {
    value.to = to;
  }
  if (prizeId !== null && prizeId.trim().length > 0) {
    value.prizeId = prizeId;
  }
  if (search !== null && search.trim().length > 0) {
    value.search = search;
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

const buildDrawResponse = async (
  request: DrawRequest,
  correlationId?: string,
): Promise<{ statusCode: number; body: DrawResponse }> => {
  const validationResult = validateDrawRequest(request);
  if ('fieldErrors' in validationResult) {
    return {
      statusCode: 400,
      body: {
        status: 'ERROR',
        code: 'VALIDATION_ERROR',
        message: validationResult.message,
        fieldErrors: validationResult.fieldErrors,
      },
    };
  }

  const campaign = await store.getCampaign();
  const currentTime = now();
  if (!isCampaignActive(campaign, currentTime)) {
    return {
      statusCode: 409,
      body: {
        status: 'ERROR',
        code: 'DRAW_ENDED',
        message:
          'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
      },
    };
  }

  const selectedPrize = selectWeightedPrize(await store.listEligiblePrizesForDraw(), Math.random);
  if (!selectedPrize) {
    return {
      statusCode: 409,
      body: {
        status: 'ERROR',
        code: 'NO_ELIGIBLE_PRIZE',
        message:
          'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
      },
    };
  }

  const claimTimestamp = currentTime.toISOString();
  const claimResult = await store.createClaimAndUpdateAggregatesAtomic({
    now: currentTime,
    ...(correlationId ? { correlationId } : {}),
    claim: {
      claimId: '',
      claimTimestamp,
      customerName: validationResult.name,
      phone: validationResult.phone,
      billNumberDisplay: validationResult.billNumberDisplay,
      billNumberNormalized: validationResult.billNumberNormalized,
      prize: {
        id: selectedPrize.selected.id,
        name: selectedPrize.selected.name,
        displayName: selectedPrize.selected.displayName,
      },
    },
  });

  if (claimResult.type === 'EXISTS') {
    return {
      statusCode: 200,
      body: {
        status: 'ALREADY_CLAIMED',
        claimId: claimResult.claim.claimId,
        claimTimestamp: claimResult.claim.claimTimestamp,
        prize: claimResult.claim.prize,
        message: 'This bill has already been used for the lucky draw.',
      },
    };
  }

  const response: DrawSuccessResponse = {
    status: 'SUCCESS',
    claimId: claimResult.claim.claimId,
    claimTimestamp: claimResult.claim.claimTimestamp,
    prize: claimResult.claim.prize,
    wheel: {
      sectorPrizeIds: selectedPrize.sectorPrizeIds,
    },
  };

  return {
    statusCode: 201,
    body: response,
  };
};

const responseJson = (statusCode: number, body: unknown) => {
  return {
    statusCode,
    headers: {
      ...jsonHeaders,
    },
    body: JSON.stringify(body),
  };
};

export const handler = async (event: {
  requestContext: { http: { method: string }; requestId?: string };
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const query = new URLSearchParams(event.rawQueryString ?? '');

  if (isRequestSizePolicyEndpoint(method, path)) {
    const observedBytes = utf8ByteLength(event.body);
    if (observedBytes > REQUEST_BODY_SIZE_LIMIT_BYTES) {
      const oversizedRequestLogContext = event.requestContext.requestId
        ? {
            requestId: event.requestContext.requestId,
          }
        : {};

      logOversizedRequest({
        layer: 'lambda',
        method,
        path,
        observedBytes,
        ...oversizedRequestLogContext,
      });

      return responseJson(413, toRequestTooLargeBody());
    }
  }

  try {
    if (method === 'POST' && path === '/api/draw') {
      const idempotencyKey = readIdempotencyKeyHeader(event.headers);
      void idempotencyKey;

      const parsed = safeParseJson(event.body);
      if (!parsed.ok || !isDrawRequest(parsed.value)) {
        return responseJson(400, {
          status: 'ERROR',
          code: 'VALIDATION_ERROR',
          message: 'Please check the form and try again.',
        });
      }

      const response = await buildDrawResponse(parsed.value, event.requestContext.requestId);
      return responseJson(response.statusCode, response.body);
    }

    if (method === 'GET' && path === '/api/admin/prizes') {
      const items = await store.listAllPrizes();
      const summary = await store.summary();
      const givenCountByPrizeId = new Map(
        summary.prizeDistribution.map((item) => [item.prizeId, item.givenCount]),
      );

      return responseJson(200, {
        status: 'SUCCESS',
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          weight: item.weight,
          active: item.active,
          givenCount: givenCountByPrizeId.get(item.id) ?? 0,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      });
    }

    if (method === 'POST' && path === '/api/admin/prizes') {
      const parsed = safeParseJson(event.body);
      if (!parsed.ok || !isCreatePrizeRequest(parsed.value)) {
        const response = validationErrorResponse();
        return responseJson(response.statusCode, response.body);
      }

      const result = await store.addPrize(parsed.value);
      if (result.type === 'VALIDATION_ERROR') {
        return responseJson(400, {
          status: 'ERROR',
          code: 'VALIDATION_ERROR',
          message: result.message,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        });
      }

      if (result.type !== 'SUCCESS') {
        return responseJson(404, {
          status: 'ERROR',
          code: 'VALIDATION_ERROR',
          message: 'Prize was not found.',
        });
      }

      return responseJson(201, {
        status: 'SUCCESS',
        item: {
          id: result.prize.id,
          name: result.prize.name,
          weight: result.prize.weight,
          active: result.prize.active,
          givenCount: 0,
          createdAt: result.prize.createdAt,
          updatedAt: result.prize.updatedAt,
        },
      });
    }

    const prizeMatch = path.match(/^\/api\/admin\/prizes\/([^/]+)$/);
    if (method === 'PATCH' && prizeMatch?.[1]) {
      const parsed = safeParseJson(event.body);
      if (!parsed.ok || !isUpdatePrizeRequest(parsed.value)) {
        const response = validationErrorResponse();
        return responseJson(response.statusCode, response.body);
      }

      const prizeId = decodeURIComponent(prizeMatch[1]);
      const result = await store.updatePrize(prizeId, parsed.value);

      if (result.type === 'NOT_FOUND') {
        const response = validationErrorResponse('Prize was not found.');
        return responseJson(response.statusCode, response.body);
      }

      if (result.type === 'VALIDATION_ERROR') {
        return responseJson(400, {
          status: 'ERROR',
          code: 'VALIDATION_ERROR',
          message: result.message,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        });
      }

      if (result.type !== 'SUCCESS') {
        return responseJson(404, {
          status: 'ERROR',
          code: 'VALIDATION_ERROR',
          message: 'Prize was not found.',
        });
      }

      return responseJson(200, {
        status: 'SUCCESS',
        item: {
          id: result.prize.id,
          name: result.prize.name,
          weight: result.prize.weight,
          active: result.prize.active,
          givenCount:
            (await store.summary()).prizeDistribution.find(
              (item) => item.prizeId === result.prize.id,
            )?.givenCount ?? 0,
          createdAt: result.prize.createdAt,
          updatedAt: result.prize.updatedAt,
        },
      });
    }

    if (method === 'GET' && path === '/api/admin/claims') {
      const parsed = parseClaimsQuery(query);
      if (!parsed.ok) {
        const response = validationErrorResponse(
          'Please check the form and try again.',
          parsed.fieldErrors,
        );
        return responseJson(response.statusCode, response.body);
      }

      const claims = await store.listAdminClaims(parsed.value);
      return responseJson(200, {
        status: 'SUCCESS',
        items: claims.items,
        nextPageToken: claims.nextPageToken,
      });
    }

    const claimDeleteMatch = path.match(/^\/api\/admin\/claims\/([^/]+)$/);
    if (method === 'DELETE' && claimDeleteMatch?.[1]) {
      const claimId = decodeURIComponent(claimDeleteMatch[1]);
      const result = await store.deleteClaim(claimId);
      if (result.type === 'NOT_FOUND') {
        const response = validationErrorResponse('Claim was not found.');
        return responseJson(response.statusCode, response.body);
      }

      return responseJson(200, { status: 'SUCCESS' });
    }

    if (method === 'DELETE' && path === '/api/admin/claims') {
      const deletedCount = await store.clearAllClaims();
      return responseJson(200, { status: 'SUCCESS', deletedCount });
    }

    if (method === 'GET' && path === '/api/admin/claims.csv') {
      let claims;
      try {
        claims = await store.listAdminClaimsForCsv();
      } catch (error) {
        if (error instanceof CsvExportTooLargeError) {
          return responseJson(413, {
            status: 'ERROR',
            code: 'EXPORT_TOO_LARGE',
            message: `The claim export is limited to ${error.limit} rows. Export from the AWS console or contact engineering for a full extract.`,
          });
        }

        throw error;
      }

      const rows = [
        ['date/time', 'claim ID', 'customer name', 'bill number', 'prize', 'phone'],
        ...claims.map((item) => [
          item.claimTimestamp,
          item.claimId,
          item.customerName,
          item.billNumber,
          item.prize,
          item.phone,
        ]),
      ];

      const csvResponse: AdminCsvResponse = {
        statusCode: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="claims.csv"',
        },
        body: rows.map((row) => row.map(toCsvCell).join(',')).join('\n'),
      };

      return {
        statusCode: csvResponse.statusCode,
        headers: csvResponse.headers,
        body: csvResponse.body,
      };
    }

    if (method === 'GET' && path === '/api/admin/summary') {
      const summary = await store.summary();
      return responseJson(200, {
        status: 'SUCCESS',
        totalSuccessfulSpins: summary.totalSuccessfulSpins,
        today: summary.today,
        prizeDistribution: summary.prizeDistribution,
      });
    }

    if (method === 'GET' && path === '/api/admin/campaign') {
      const campaign = await store.getCampaign();
      return responseJson(200, {
        status: 'SUCCESS',
        campaign,
      });
    }

    if (method === 'PATCH' && path === '/api/admin/campaign') {
      const parsed = safeParseJson(event.body);
      if (!parsed.ok || !isCampaignUpdateRequest(parsed.value)) {
        const response = validationErrorResponse();
        return responseJson(response.statusCode, response.body);
      }

      const result = await store.updateCampaign(parsed.value);
      if (result.type === 'VALIDATION_ERROR') {
        return responseJson(400, {
          status: 'ERROR',
          code: 'VALIDATION_ERROR',
          message: result.message,
          fieldErrors: result.fieldErrors,
        });
      }

      const campaign = await store.getCampaign();
      return responseJson(200, {
        status: 'SUCCESS',
        campaign,
      });
    }

    return responseJson(404, {
      status: 'ERROR',
      code: 'INTERNAL_ERROR',
      message: 'Route not found.',
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'UNHANDLED_REQUEST_ERROR',
        method,
        path,
        errorName: error instanceof Error ? error.name : typeof error,
        requestId: event.requestContext.requestId,
      }),
    );

    if (path === '/api/draw') {
      return responseJson(500, drawInternalErrorResponse().body);
    }

    const response = internalErrorResponse();
    return responseJson(response.statusCode, response.body);
  }
};

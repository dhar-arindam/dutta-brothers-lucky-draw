import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { campaignDateInKolkata, campaignYearInKolkata, isCampaignActive } from './campaign.js';
import type { AdminClaimItem, AdminSummaryDistributionItem } from './contracts.js';
import type { Claim, ConfiguredPrize, Prize } from './domain.js';
import { classifyTransactionCancellation, computeBackoffDelayMs } from './dynamodb-retry.js';
import { CSV_EXPORT_MAX_ROWS, CsvExportTooLargeError } from './store.js';
import type {
  AddPrizeInput,
  AdminCsvClaimItem,
  AdminClaimsQuery,
  AdminClaimsQueryResult,
  AdminPrizeMutationResult,
  AdminSummaryData,
  CampaignUpdateInput,
  CampaignUpdateResult,
  CampaignView,
  CreateClaimInput,
  CreateClaimResult,
  UpdatePrizeInput,
} from './store.js';

interface CampaignConfig {
  id: string;
  timezone: 'Asia/Kolkata';
  fromDate: string;
  toDate: string;
}

interface DynamoLikeClient {
  send(command: unknown): Promise<unknown>;
}

interface DurableStoreOptions {
  tableName: string;
  now?: () => Date;
  // Transient DynamoDB transaction-contention retry tuning (all optional, sensible defaults below).
  maxTransactionAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_TRANSACTION_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 25;
const DEFAULT_RETRY_MAX_DELAY_MS = 400;

// Safe structured log line for transaction diagnostics. Never includes customer
// name, phone, or bill number -- only operation metadata and error classification.
const logTransactionOutcome = (event: Record<string, unknown>): void => {
  console.log(JSON.stringify({ operation: 'createClaimAndUpdateAggregatesAtomic', ...event }));
};

const DEFAULT_CAMPAIGN: CampaignConfig = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  fromDate: '2026-08-01',
  toDate: '2026-11-01',
};

const MAX_PRIZE_NAME_LENGTH = 100;

interface ClaimEntity {
  pk: 'CLAIM';
  sk: string;
  entityType: 'CLAIM';
  claimId: string;
  claimTimestamp: string;
  customerName: string;
  phone: string;
  billNumberDisplay: string;
  billNumberNormalized: string;
  prize: {
    id: string;
    name: string;
    displayName: string;
  };
  gsi1pk: 'CLAIM';
  gsi1sk: string;
}

interface BillEntity {
  pk: 'BILL';
  sk: string;
  entityType: 'BILL';
  claimId: string;
  createdAt: string;
}

interface PrizeEntity {
  pk: 'PRIZE';
  sk: string;
  entityType: 'PRIZE';
  id: string;
  name: string;
  displayName: string;
  weight: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AggregateEntity {
  pk: 'AGG';
  sk: string;
  entityType: 'AGG';
  successfulSpins: number;
  prizeId?: string;
  prizeName?: string;
  updatedAt: string;
}

interface CampaignEntity {
  pk: 'CAMPAIGN';
  sk: 'CONFIG';
  entityType: 'CAMPAIGN';
  id: string;
  timezone: 'Asia/Kolkata';
  fromDate: string;
  toDate: string;
}

export class DynamoDbDrawStore {
  private readonly tableName: string;
  private readonly docClient: DynamoLikeClient;
  private readonly nowProvider: () => Date;
  private readonly maxTransactionAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(docClient: DynamoLikeClient, options: DurableStoreOptions) {
    this.docClient = docClient;
    this.tableName = options.tableName;
    this.nowProvider = options.now ?? (() => new Date());
    this.maxTransactionAttempts =
      options.maxTransactionAttempts ?? DEFAULT_MAX_TRANSACTION_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.random = options.random ?? Math.random;
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public async createClaimAndUpdateAggregatesAtomic(
    input: CreateClaimInput,
  ): Promise<CreateClaimResult> {
    const sequence = await this.nextSequence('CLAIM');
    const claimId = toClaimId(sequence);
    const claimTimestamp = input.claim.claimTimestamp;

    const claim: Claim = {
      ...input.claim,
      claimId,
      claimTimestamp,
    };

    const dateKey = campaignDateInKolkata(input.now);
    const timestamp = this.nowProvider().toISOString();

    const billEntity: BillEntity = {
      pk: 'BILL',
      sk: claim.billNumberNormalized,
      entityType: 'BILL',
      claimId: claim.claimId,
      createdAt: timestamp,
    };

    const claimEntity: ClaimEntity = {
      pk: 'CLAIM',
      sk: claim.claimId,
      entityType: 'CLAIM',
      claimId: claim.claimId,
      claimTimestamp: claim.claimTimestamp,
      customerName: claim.customerName,
      phone: claim.phone,
      billNumberDisplay: claim.billNumberDisplay,
      billNumberNormalized: claim.billNumberNormalized,
      prize: claim.prize,
      gsi1pk: 'CLAIM',
      gsi1sk: `${claim.claimTimestamp}#${claim.claimId}`,
    };

    const transactWriteCommand = new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: billEntity,
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: claimEntity,
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
          },
        },
        {
          Update: {
            TableName: this.tableName,
            Key: {
              pk: 'AGG',
              sk: 'TOTAL',
            },
            UpdateExpression:
              'SET #entityType = :aggType, #updatedAt = :updatedAt ADD #successfulSpins :one',
            ExpressionAttributeNames: {
              '#entityType': 'entityType',
              '#updatedAt': 'updatedAt',
              '#successfulSpins': 'successfulSpins',
            },
            ExpressionAttributeValues: {
              ':aggType': 'AGG',
              ':updatedAt': timestamp,
              ':one': 1,
            },
          },
        },
        {
          Update: {
            TableName: this.tableName,
            Key: {
              pk: 'AGG',
              sk: `DATE#${dateKey}`,
            },
            UpdateExpression:
              'SET #entityType = :aggType, #updatedAt = :updatedAt ADD #successfulSpins :one',
            ExpressionAttributeNames: {
              '#entityType': 'entityType',
              '#updatedAt': 'updatedAt',
              '#successfulSpins': 'successfulSpins',
            },
            ExpressionAttributeValues: {
              ':aggType': 'AGG',
              ':updatedAt': timestamp,
              ':one': 1,
            },
          },
        },
        {
          Update: {
            TableName: this.tableName,
            Key: {
              pk: 'AGG',
              sk: `PRIZE#${claim.prize.id}`,
            },
            UpdateExpression:
              'SET #entityType = :aggType, #prizeId = :prizeId, #prizeName = :prizeName, #updatedAt = :updatedAt ADD #successfulSpins :one',
            ExpressionAttributeNames: {
              '#entityType': 'entityType',
              '#prizeId': 'prizeId',
              '#prizeName': 'prizeName',
              '#updatedAt': 'updatedAt',
              '#successfulSpins': 'successfulSpins',
            },
            ExpressionAttributeValues: {
              ':aggType': 'AGG',
              ':prizeId': claim.prize.id,
              ':prizeName': claim.prize.name,
              ':updatedAt': timestamp,
              ':one': 1,
            },
          },
        },
      ],
    });

    // TransactItems positions 0 (BILL put) and 1 (CLAIM put) carry the uniqueness
    // conditions; positions 2-4 are shared aggregate counters that can legitimately
    // contend with other concurrent, unrelated claims and must be retried, not
    // misread as a duplicate bill.
    const DUPLICATE_CHECK_INDEXES = [0, 1];

    for (let attempt = 1; attempt <= this.maxTransactionAttempts; attempt += 1) {
      try {
        await this.docClient.send(transactWriteCommand);
        return {
          type: 'CREATED',
          claim,
        };
      } catch (error) {
        const classification = classifyTransactionCancellation(error, DUPLICATE_CHECK_INDEXES);

        if (classification.category === 'DUPLICATE') {
          logTransactionOutcome({
            event: 'DUPLICATE_CLAIM_DETECTED',
            attempt,
            reasonCodes: classification.reasonCodes,
            correlationId: input.correlationId,
          });

          const existing = await this.getClaimByNormalizedBill(claim.billNumberNormalized);
          if (existing) {
            return {
              type: 'EXISTS',
              claim: existing,
            };
          }

          logTransactionOutcome({
            event: 'DUPLICATE_CLAIM_UNRESOLVED',
            attempt,
            correlationId: input.correlationId,
          });
          throw new Error('Unable to persist claim transaction.');
        }

        const canRetry =
          classification.category === 'TRANSIENT' && attempt < this.maxTransactionAttempts;
        if (canRetry) {
          const delayMs = computeBackoffDelayMs(attempt, {
            baseDelayMs: this.retryBaseDelayMs,
            maxDelayMs: this.retryMaxDelayMs,
            random: this.random,
          });
          logTransactionOutcome({
            event: 'TRANSIENT_CONTENTION_RETRY',
            attempt,
            maxAttempts: this.maxTransactionAttempts,
            delayMs,
            reasonCodes: classification.reasonCodes,
            errorName: classification.errorName,
            correlationId: input.correlationId,
          });
          await this.sleep(delayMs);
          continue;
        }

        logTransactionOutcome({
          event:
            classification.category === 'TRANSIENT'
              ? 'TRANSIENT_CONTENTION_RETRY_EXHAUSTED'
              : 'PERMANENT_TRANSACTION_FAILURE',
          attempt,
          maxAttempts: this.maxTransactionAttempts,
          reasonCodes: classification.reasonCodes,
          errorName: classification.errorName,
          correlationId: input.correlationId,
        });
        throw error instanceof Error ? error : new Error('Unable to persist claim transaction.');
      }
    }

    // Unreachable: the loop above always returns or throws, but TypeScript
    // requires an explicit terminal statement for the async function's return type.
    throw new Error('Unable to persist claim transaction.');
  }

  public async listEligiblePrizesForDraw(): Promise<Prize[]> {
    const prizes = await this.listAllPrizes();
    return prizes.filter((prize) => prize.active && prize.weight > 0);
  }

  public async listAllPrizes(): Promise<ConfiguredPrize[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'PRIZE',
        },
      }),
    );

    const items = ((result as { Items?: PrizeEntity[] }).Items ?? []).map(toConfiguredPrize);
    return items.sort((left, right) => left.id.localeCompare(right.id));
  }

  public async addPrize(input: AddPrizeInput): Promise<AdminPrizeMutationResult> {
    const validationError = validatePrizeInput(input);
    if (validationError) {
      return validationError;
    }

    const sequence = await this.nextSequence('PRIZE');
    const id = `prize-${sequence.toString().padStart(3, '0')}`;
    const timestamp = this.nowProvider().toISOString();

    const item: PrizeEntity = {
      pk: 'PRIZE',
      sk: id,
      entityType: 'PRIZE',
      id,
      name: input.name.trim(),
      displayName: input.name.trim(),
      weight: input.weight,
      active: input.active,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }),
    );

    return {
      type: 'SUCCESS',
      prize: toConfiguredPrize(item),
    };
  }

  public async updatePrize(
    prizeId: string,
    input: UpdatePrizeInput,
  ): Promise<AdminPrizeMutationResult> {
    const existing = await this.getPrize(prizeId);
    if (!existing) {
      return {
        type: 'NOT_FOUND',
        message: 'Prize was not found.',
      };
    }

    if (input.weight === undefined && input.active === undefined) {
      return {
        type: 'VALIDATION_ERROR',
        message: 'Please check the form and try again.',
        fieldErrors: {
          weight: 'At least one updatable field is required.',
        },
      };
    }

    const nextWeight = input.weight ?? existing.weight;
    const nextActive = input.active ?? existing.active;
    const validationError = validatePrizeInput({
      name: existing.name,
      weight: nextWeight,
      active: nextActive,
    });
    if (validationError) {
      return validationError;
    }

    const updatedAt = this.nowProvider().toISOString();

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: 'PRIZE', sk: prizeId },
        ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        UpdateExpression: 'SET #weight = :weight, #active = :active, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#weight': 'weight',
          '#active': 'active',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':weight': nextWeight,
          ':active': nextActive,
          ':updatedAt': updatedAt,
        },
      }),
    );

    const latest = await this.getPrize(prizeId);
    if (!latest) {
      throw new Error('Updated prize could not be read.');
    }

    return {
      type: 'SUCCESS',
      prize: latest,
    };
  }

  public async listAdminClaims(query: AdminClaimsQuery): Promise<AdminClaimsQueryResult> {
    const pageSize = clampPageSize(query.pageSize);
    const search = (query.search ?? '').trim();
    const normalizedSearch = search.toUpperCase();
    const searchLower = search.toLowerCase();

    let exclusiveStartKey = decodePageToken(query.pageToken);
    const claims: AdminClaimItem[] = [];

    do {
      const page = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': 'CLAIM',
          },
          ExclusiveStartKey: exclusiveStartKey ?? undefined,
          ScanIndexForward: false,
          Limit: pageSize,
        }),
      );

      const pageItems = ((page as { Items?: ClaimEntity[] }).Items ?? []).map(toClaimFromEntity);

      for (const claim of pageItems) {
        if (!passesClaimFilter(claim, query, search, normalizedSearch, searchLower)) {
          continue;
        }

        claims.push({
          claimId: claim.claimId,
          claimTimestamp: claim.claimTimestamp,
          customerName: claim.customerName,
          maskedPhone: maskPhone(claim.phone),
          billNumber: claim.billNumberDisplay,
          prize: claim.prize.name,
        });

        if (claims.length >= pageSize) {
          break;
        }
      }

      exclusiveStartKey = (page as { LastEvaluatedKey?: Record<string, unknown> }).LastEvaluatedKey;
      if (claims.length >= pageSize) {
        break;
      }
    } while (exclusiveStartKey);

    return {
      items: claims,
      nextPageToken: exclusiveStartKey ? encodePageToken(exclusiveStartKey) : null,
    };
  }

  public async listAdminClaimsForCsv(year: number): Promise<AdminCsvClaimItem[]> {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const claims: AdminCsvClaimItem[] = [];

    do {
      const page = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': 'CLAIM',
          },
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: false,
          Limit: 100,
        }),
      );

      const pageItems = ((page as { Items?: ClaimEntity[] }).Items ?? []).map(toClaimFromEntity);
      for (const claim of pageItems) {
        if (campaignYearInKolkata(new Date(claim.claimTimestamp)) !== year) {
          continue;
        }

        if (claims.length >= CSV_EXPORT_MAX_ROWS) {
          throw new CsvExportTooLargeError(CSV_EXPORT_MAX_ROWS);
        }

        claims.push({
          claimId: claim.claimId,
          claimTimestamp: claim.claimTimestamp,
          customerName: claim.customerName,
          phone: claim.phone,
          billNumber: claim.billNumberDisplay,
          prize: claim.prize.name,
        });
      }

      exclusiveStartKey = (page as { LastEvaluatedKey?: Record<string, unknown> }).LastEvaluatedKey;
    } while (exclusiveStartKey);

    return claims;
  }

  public async summary(): Promise<AdminSummaryData> {
    const totalItem = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: 'AGG', sk: 'TOTAL' },
      }),
    );

    const todayDate = campaignDateInKolkata(this.nowProvider());
    const todayItem = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: 'AGG', sk: `DATE#${todayDate}` },
      }),
    );

    const distributionQuery = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': 'AGG',
          ':prefix': 'PRIZE#',
        },
      }),
    );

    // Daily aggregates, not claims, so the year list never costs a table scan.
    const dailyQuery = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': 'AGG',
          ':prefix': 'DATE#',
        },
        ProjectionExpression: '#sk, #successfulSpins',
        ExpressionAttributeNames: { '#sk': 'sk', '#successfulSpins': 'successfulSpins' },
      }),
    );

    const exportYears = new Set<number>();
    for (const item of (dailyQuery as { Items?: AggregateEntity[] }).Items ?? []) {
      if (Number(item.successfulSpins ?? 0) > 0) {
        exportYears.add(Number(item.sk.replace('DATE#', '').slice(0, 4)));
      }
    }

    const totalSuccessfulSpins = Number(
      (totalItem as { Item?: AggregateEntity }).Item?.successfulSpins ?? 0,
    );
    const todaySuccessfulSpins = Number(
      (todayItem as { Item?: AggregateEntity }).Item?.successfulSpins ?? 0,
    );

    const prizeDistribution = ((distributionQuery as { Items?: AggregateEntity[] }).Items ?? [])
      .map((item): AdminSummaryDistributionItem => {
        const prizeId = item.prizeId ?? item.sk.replace('PRIZE#', '');
        return {
          prizeId,
          prizeName: item.prizeName ?? prizeId,
          givenCount: Number(item.successfulSpins ?? 0),
        };
      })
      .sort((left, right) => left.prizeId.localeCompare(right.prizeId));

    return {
      totalSuccessfulSpins,
      today: {
        date: todayDate,
        successfulSpins: todaySuccessfulSpins,
      },
      prizeDistribution,
      availableExportYears: [...exportYears].sort((left, right) => right - left),
    };
  }

  public async getCampaign(): Promise<CampaignView> {
    const item = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: 'CAMPAIGN', sk: 'CONFIG' },
      }),
    );

    const campaign = toCampaignConfig((item as { Item?: CampaignEntity }).Item) ?? DEFAULT_CAMPAIGN;
    const status = isCampaignActive(campaign, this.nowProvider()) ? 'ACTIVE' : 'ENDED';

    return {
      ...campaign,
      status,
    };
  }

  public async updateCampaign(input: CampaignUpdateInput): Promise<CampaignUpdateResult> {
    const current = await this.getCampaign();
    const fromDate = input.fromDate ?? current.fromDate;
    const toDate = input.toDate ?? current.toDate;
    const fieldErrors: Partial<Record<'fromDate' | 'toDate', string>> = {};

    const fromMillis = parseIsoDate(fromDate);
    const toMillis = parseIsoDate(toDate);

    if (fromMillis === null) {
      fieldErrors.fromDate = 'From Date must be a valid calendar date.';
    }
    if (toMillis === null) {
      fieldErrors.toDate = 'To Date must be a valid calendar date.';
    }

    if (
      Object.keys(fieldErrors).length === 0 &&
      fromMillis !== null &&
      toMillis !== null &&
      fromMillis > toMillis
    ) {
      fieldErrors.toDate = 'To Date must be on or after From Date.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        type: 'VALIDATION_ERROR',
        message: 'Please check the form and try again.',
        fieldErrors,
      };
    }

    const item: CampaignEntity = {
      pk: 'CAMPAIGN',
      sk: 'CONFIG',
      entityType: 'CAMPAIGN',
      id: current.id,
      timezone: 'Asia/Kolkata',
      fromDate,
      toDate,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );

    return {
      type: 'SUCCESS',
      campaign: {
        id: item.id,
        timezone: item.timezone,
        fromDate: item.fromDate,
        toDate: item.toDate,
      },
    };
  }

  public async getClaimById(claimId: string): Promise<Claim | undefined> {
    const item = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: 'CLAIM',
          sk: claimId,
        },
      }),
    );

    const entity = (item as { Item?: ClaimEntity }).Item;
    if (!entity) {
      return undefined;
    }

    return toClaimFromEntity(entity);
  }

  public async deleteClaim(claimId: string): Promise<{ type: 'SUCCESS' } | { type: 'NOT_FOUND' }> {
    const claim = await this.getClaimById(claimId);
    if (!claim) {
      return { type: 'NOT_FOUND' };
    }

    const dateKey = campaignDateInKolkata(new Date(claim.claimTimestamp));
    const timestamp = this.nowProvider().toISOString();

    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.tableName,
              Key: { pk: 'BILL', sk: claim.billNumberNormalized },
            },
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: { pk: 'CLAIM', sk: claim.claimId },
              ConditionExpression: 'attribute_exists(pk)',
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: 'AGG', sk: 'TOTAL' },
              UpdateExpression: 'SET #updatedAt = :updatedAt ADD #successfulSpins :minusOne',
              ExpressionAttributeNames: {
                '#updatedAt': 'updatedAt',
                '#successfulSpins': 'successfulSpins',
              },
              ExpressionAttributeValues: {
                ':updatedAt': timestamp,
                ':minusOne': -1,
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: 'AGG', sk: `DATE#${dateKey}` },
              UpdateExpression: 'SET #updatedAt = :updatedAt ADD #successfulSpins :minusOne',
              ExpressionAttributeNames: {
                '#updatedAt': 'updatedAt',
                '#successfulSpins': 'successfulSpins',
              },
              ExpressionAttributeValues: {
                ':updatedAt': timestamp,
                ':minusOne': -1,
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: 'AGG', sk: `PRIZE#${claim.prize.id}` },
              UpdateExpression: 'SET #updatedAt = :updatedAt ADD #successfulSpins :minusOne',
              ExpressionAttributeNames: {
                '#updatedAt': 'updatedAt',
                '#successfulSpins': 'successfulSpins',
              },
              ExpressionAttributeValues: {
                ':updatedAt': timestamp,
                ':minusOne': -1,
              },
            },
          },
        ],
      }),
    );

    return { type: 'SUCCESS' };
  }

  // BILL keys are removed before CLAIM keys so that an interrupted run leaves bills claimable
  // again, matching the intent of a reset. The reverse order would strand BILL guards that
  // permanently block legitimate customers with no matching claim to explain why.
  public async clearAllClaims(): Promise<number> {
    await this.deleteAllByPartition('BILL');
    const deletedClaims = await this.deleteAllByPartition('CLAIM');
    await this.deleteAllByPartition('AGG');

    return deletedClaims;
  }

  // Deletes each page as it is read, so memory stays bounded regardless of table size.
  private async deleteAllByPartition(pk: 'CLAIM' | 'BILL' | 'AGG'): Promise<number> {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    let deleted = 0;

    do {
      const page = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ProjectionExpression: '#pk, #sk',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      const keys = ((page as { Items?: Array<{ pk: string; sk: string }> }).Items ?? []).map(
        (entry) => ({ pk: entry.pk, sk: entry.sk }),
      );

      await this.batchDelete(keys);
      deleted += keys.length;

      exclusiveStartKey = (page as { LastEvaluatedKey?: Record<string, unknown> }).LastEvaluatedKey;
    } while (exclusiveStartKey);

    return deleted;
  }

  private async batchDelete(keys: Array<{ pk: string; sk: string }>): Promise<void> {
    const chunkSize = 25;
    for (let index = 0; index < keys.length; index += chunkSize) {
      const chunk = keys.slice(index, index + chunkSize);
      if (chunk.length === 0) {
        continue;
      }

      await this.sendBatchDeleteWithRetries(chunk.map((key) => ({ DeleteRequest: { Key: key } })));
    }
  }

  // BatchWriteItem reports throttled writes in UnprocessedItems instead of failing, so the
  // leftovers must be resent or the delete silently loses items while reporting success.
  private async sendBatchDeleteWithRetries(
    requests: Array<{ DeleteRequest: { Key: { pk: string; sk: string } } }>,
  ): Promise<void> {
    let pending = requests;

    for (let attempt = 1; attempt <= this.maxTransactionAttempts; attempt += 1) {
      const response = await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: pending,
          },
        }),
      );

      const unprocessed = (
        response as {
          UnprocessedItems?: Record<
            string,
            Array<{ DeleteRequest?: { Key: { pk: string; sk: string } } }>
          >;
        }
      ).UnprocessedItems?.[this.tableName];

      if (!unprocessed || unprocessed.length === 0) {
        return;
      }

      pending = unprocessed.filter(
        (item): item is { DeleteRequest: { Key: { pk: string; sk: string } } } =>
          item.DeleteRequest !== undefined,
      );

      if (pending.length === 0) {
        return;
      }

      if (attempt < this.maxTransactionAttempts) {
        await this.sleep(
          computeBackoffDelayMs(attempt, {
            baseDelayMs: this.retryBaseDelayMs,
            maxDelayMs: this.retryMaxDelayMs,
            random: this.random,
          }),
        );
      }
    }

    throw new Error(
      `Batch delete could not process ${pending.length} item(s) after ${this.maxTransactionAttempts} attempts.`,
    );
  }

  private async getClaimByNormalizedBill(billNumberNormalized: string): Promise<Claim | undefined> {
    const billItem = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: 'BILL',
          sk: billNumberNormalized,
        },
      }),
    );

    const bill = (billItem as { Item?: BillEntity }).Item;
    if (!bill) {
      return undefined;
    }

    return this.getClaimById(bill.claimId);
  }

  private async getPrize(prizeId: string): Promise<ConfiguredPrize | undefined> {
    const item = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: 'PRIZE',
          sk: prizeId,
        },
      }),
    );

    const entity = (item as { Item?: PrizeEntity }).Item;
    if (!entity) {
      return undefined;
    }

    return toConfiguredPrize(entity);
  }

  private async nextSequence(sequenceName: 'CLAIM' | 'PRIZE'): Promise<number> {
    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: 'SEQ',
          sk: sequenceName,
        },
        UpdateExpression: 'ADD #value :inc',
        ExpressionAttributeNames: {
          '#value': 'value',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );

    const value = Number((result as { Attributes?: { value?: number } }).Attributes?.value ?? 0);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid ${sequenceName} sequence value.`);
    }

    return value;
  }
}

const toClaimId = (sequence: number): string => {
  if (sequence > 999999) {
    throw new Error('Claim sequence exceeded six-digit capacity.');
  }

  return `DB26-${sequence.toString().padStart(6, '0')}`;
};

const toConfiguredPrize = (entity: PrizeEntity): ConfiguredPrize => {
  return {
    id: entity.id,
    name: entity.name,
    displayName: entity.displayName,
    weight: entity.weight,
    active: entity.active,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
};

const toCampaignConfig = (entity: CampaignEntity | undefined): CampaignConfig | undefined => {
  if (!entity) {
    return undefined;
  }

  const fromDate =
    entity.fromDate ?? toIsoDateFromTimestamp((entity as { startAt?: string }).startAt);
  const toDate = entity.toDate ?? toIsoDateFromTimestamp((entity as { endAt?: string }).endAt);
  if (!fromDate || !toDate) {
    return undefined;
  }

  return {
    id: entity.id,
    timezone: entity.timezone,
    fromDate,
    toDate,
  };
};

const toIsoDateFromTimestamp = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

const parseIsoDate = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return candidate.getTime();
};

const toClaimFromEntity = (entity: ClaimEntity): Claim => {
  return {
    claimId: entity.claimId,
    claimTimestamp: entity.claimTimestamp,
    customerName: entity.customerName,
    phone: entity.phone,
    billNumberDisplay: entity.billNumberDisplay,
    billNumberNormalized: entity.billNumberNormalized,
    prize: {
      id: entity.prize.id,
      name: entity.prize.name,
      displayName: entity.prize.displayName,
    },
  };
};

const clampPageSize = (value: number | undefined): number => {
  if (value === undefined) {
    return 25;
  }

  if (!Number.isInteger(value) || value < 1 || value > 150) {
    return 25;
  }

  return value;
};

const encodePageToken = (key: Record<string, unknown>): string => {
  return Buffer.from(JSON.stringify(key), 'utf-8').toString('base64url');
};

const decodePageToken = (token: string | undefined): Record<string, unknown> | undefined => {
  if (!token) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    if (!decoded || typeof decoded !== 'object') {
      return undefined;
    }

    return decoded as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  const tail = digits.slice(-4);
  return `*****${tail.padStart(4, '*')}`;
};

const passesClaimFilter = (
  claim: Claim,
  query: AdminClaimsQuery,
  search: string,
  normalizedSearch: string,
  searchLower: string,
): boolean => {
  const claimMillis = new Date(claim.claimTimestamp).getTime();
  if (query.from) {
    const fromMillis = Date.parse(query.from);
    if (!Number.isNaN(fromMillis) && claimMillis < fromMillis) {
      return false;
    }
  }

  if (query.to) {
    const toMillis = Date.parse(query.to);
    if (!Number.isNaN(toMillis) && claimMillis > toMillis) {
      return false;
    }
  }

  if (query.prizeId && claim.prize.id !== query.prizeId) {
    return false;
  }

  if (!search) {
    return true;
  }

  const customerName = claim.customerName.trim().toLowerCase();
  const prizeName = claim.prize.name.trim().toLowerCase();

  return (
    claim.claimId.toLowerCase().includes(searchLower) ||
    customerName.includes(searchLower) ||
    claim.billNumberNormalized.includes(normalizedSearch) ||
    prizeName.includes(searchLower)
  );
};

const validatePrizeInput = (
  input: AddPrizeInput,
): Extract<AdminPrizeMutationResult, { type: 'VALIDATION_ERROR' }> | null => {
  const fieldErrors: Partial<Record<'name' | 'weight' | 'active', string>> = {};
  const normalizedName = input.name.trim();

  if (normalizedName.length === 0) {
    fieldErrors.name = 'Prize name is required.';
  } else if (normalizedName.length > MAX_PRIZE_NAME_LENGTH) {
    fieldErrors.name = 'Prize name must be at most 100 characters.';
  }

  if (!Number.isFinite(input.weight) || input.weight <= 0) {
    fieldErrors.weight = 'Weight must be a positive number.';
  }

  if (typeof input.active !== 'boolean') {
    fieldErrors.active = 'Active flag must be true or false.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      type: 'VALIDATION_ERROR',
      message: 'Please check the form and try again.',
      fieldErrors,
    };
  }

  return null;
};

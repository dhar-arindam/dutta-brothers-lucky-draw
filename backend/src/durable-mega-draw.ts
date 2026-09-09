import { createHash, randomInt, randomUUID } from 'node:crypto';

import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { campaignYearInKolkata } from './campaign.js';
import { DynamoDbDrawStore } from './durable-dynamodb-store.js';
import {
  MegaDrawError,
  type MegaCandidate,
  type MegaCampaignSnapshot,
  type MegaDrawExecutionStatus,
  type MegaDrawHistory,
  type MegaDrawLifecycle,
  type MegaPreflight,
  type MegaPrize,
  type MegaSelectedRow,
} from './mega-draw.js';

interface DynamoLikeClient {
  send(command: unknown): Promise<unknown>;
}

interface MegaItem {
  pk: string;
  sk: string;
  entityType: string;
  value?: unknown;
  expiresAt?: number;
}

interface StoredPreflight extends MegaPreflight {
  candidates: MegaCandidate[];
  fingerprint: string;
}
interface Execution {
  fingerprint: string;
  operation: 'DRAW_NEXT';
  lifecycle: MegaDrawLifecycle;
  selectedRow?: MegaSelectedRow;
}
interface CurrentEpoch {
  epoch: string;
}

const RETENTION_SECONDS = 7 * 365 * 24 * 60 * 60;
const PREFLIGHT_SECONDS = 5 * 60;

export class DurableMegaDrawService {
  public constructor(
    private readonly client: DynamoLikeClient,
    private readonly tableName: string,
    private readonly drawStore: DynamoDbDrawStore,
    private readonly now: () => Date = () => new Date(),
    private readonly secureIndex: (upperExclusive: number) => number = randomInt,
  ) {}

  public async get(): Promise<{
    configuration: MegaPrize[];
    lifecycle?: MegaDrawLifecycle;
    history: MegaDrawHistory[];
  }> {
    const year = campaignYearInKolkata(this.now());
    const current = await this.currentEpoch(year);
    const [configuration, state, history] = await Promise.all([
      this.readValue<MegaPrize[]>(year, 'CONFIG'),
      this.readValue<MegaDrawLifecycle>(year, scoped(current, 'STATE')),
      this.readValue<MegaDrawHistory[]>(year, 'HISTORY'),
    ]);
    return {
      configuration: configuration ?? [],
      ...(state ? { lifecycle: state } : {}),
      history: history ?? [],
    };
  }

  public async status(
    idempotencyKey: string,
    operatorSubject: string,
  ): Promise<MegaDrawExecutionStatus> {
    const year = campaignYearInKolkata(this.now());
    const storedKey = scoped(
      await this.currentEpoch(year),
      idempotencyStorageKey(operatorSubject, idempotencyKey),
    );
    const record = await this.readValue<Execution>(year, storedKey);
    return record
      ? {
          execution: 'COMPLETED',
          operation: record.operation,
          lifecycle: record.lifecycle,
          ...(record.selectedRow ? { selectedRow: record.selectedRow } : {}),
        }
      : { execution: 'NOT_FOUND' };
  }

  public async configure(prizeNames: string[]): Promise<MegaPrize[]> {
    const year = campaignYearInKolkata(this.now());
    const current = await this.currentEpoch(year);
    const state = await this.readValue<MegaDrawLifecycle>(year, scoped(current, 'STATE'));
    if (state?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    if (state)
      throw new MegaDrawError(
        'MEGA_DRAW_CONFIGURATION_LOCKED',
        'Mega Draw configuration is locked after the first selection.',
      );
    const prizes = validatePrizes(prizeNames);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: key(year),
          sk: 'CONFIG',
          entityType: 'MEGA_CONFIG',
          value: prizes,
          updatedAt: this.now().toISOString(),
        },
      }),
    );
    return prizes;
  }

  public async preflight(): Promise<MegaPreflight> {
    const year = campaignYearInKolkata(this.now());
    const current = await this.currentEpoch(year);
    const state = await this.readValue<MegaDrawLifecycle>(year, scoped(current, 'STATE'));
    if (state?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    const context = await this.currentContext();
    const reference = `MD-${context.year}-${randomUUID()}`;
    const expiresAt = new Date(this.now().getTime() + PREFLIGHT_SECONDS * 1000).toISOString();
    const stored: StoredPreflight = {
      reference,
      executionYear: context.year,
      expiresAt,
      candidateCount: context.candidates.length,
      prizes: context.prizes,
      campaign: context.campaign,
      candidates: context.candidates,
      fingerprint: fingerprint(context),
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: key(context.year),
          sk: scoped(current, `PREFLIGHT#${reference}`),
          entityType: 'MEGA_PREFLIGHT',
          value: stored,
          expiresAt: epoch(expiresAt),
        },
      }),
    );
    return publicPreflight(stored);
  }

  public async drawNext(input: {
    preflightReference?: string;
    idempotencyKey: string;
    operatorSubject: string;
    acknowledgement?: boolean;
    confirmation?: string;
    correlationId?: string;
  }): Promise<{
    lifecycle: import('./mega-draw.js').MegaDrawLifecycle;
    selectedRow: import('./mega-draw.js').MegaSelectedRow;
  }> {
    const year = campaignYearInKolkata(this.now());
    const currentEpoch = await this.currentEpoch(year);
    const storageKey = scoped(
      currentEpoch,
      idempotencyStorageKey(input.operatorSubject, input.idempotencyKey),
    );
    const requestFingerprint = fingerprint({
      operation: 'DRAW_NEXT',
      preflightReference: input.preflightReference,
      acknowledgement: input.acknowledgement ?? true,
      confirmation: input.confirmation ?? `DRAW NEXT MEGA PRIZE ${year}`,
    });
    const prior = await this.readValue<Execution>(year, storageKey);
    if (prior) return recoverDrawNext(prior, requestFingerprint);
    const current = await this.readValue<MegaDrawLifecycle>(year, scoped(currentEpoch, 'STATE'));
    if (current?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    if (current?.status === 'COMPLETED')
      throw new MegaDrawError('MEGA_DRAW_ALREADY_COMPLETED', 'Mega Draw has already completed.');
    const lifecycle =
      current ?? (await this.startFromPreflight(input.preflightReference, year, currentEpoch));
    const ordinal = lifecycle.nextPrizeOrdinal;
    const selectedRow = selectNext(lifecycle, this.secureIndex, this.now);
    const updated = advance(lifecycle, selectedRow, this.now);
    const timestamp = this.now().toISOString();
    const execution: Execution = {
      fingerprint: requestFingerprint,
      operation: 'DRAW_NEXT',
      lifecycle: updated,
      selectedRow,
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: { pk: key(year), sk: 'CURRENT' },
                ConditionExpression: 'attribute_not_exists(pk) OR #value.#epoch = :epoch',
                ExpressionAttributeNames: { '#value': 'value', '#epoch': 'epoch' },
                ExpressionAttributeValues: { ':epoch': currentEpoch },
              },
            },
            current
              ? {
                  Update: {
                    TableName: this.tableName,
                    Key: { pk: key(year), sk: scoped(currentEpoch, 'STATE') },
                    ConditionExpression:
                      '#value.#reference = :reference AND #value.#ordinal = :ordinal',
                    UpdateExpression: 'SET #value = :value, updatedAt = :updatedAt',
                    ExpressionAttributeNames: {
                      '#value': 'value',
                      '#reference': 'reference',
                      '#ordinal': 'nextPrizeOrdinal',
                    },
                    ExpressionAttributeValues: {
                      ':reference': lifecycle.reference,
                      ':ordinal': ordinal,
                      ':value': updated,
                      ':updatedAt': timestamp,
                    },
                  },
                }
              : {
                  Put: {
                    TableName: this.tableName,
                    Item: retained(year, scoped(currentEpoch, 'STATE'), 'MEGA_STATE', updated),
                    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                  },
                },
            {
              Put: {
                TableName: this.tableName,
                Item: retained(year, storageKey, 'MEGA_IDEMPOTENCY', execution),
                ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
    } catch {
      const recovered = await this.readValue<Execution>(year, storageKey);
      if (recovered) return recoverDrawNext(recovered, requestFingerprint);
      throw new MegaDrawError('MEGA_DRAW_IN_PROGRESS', 'Mega Draw execution is in progress.');
    }
    return { lifecycle: updated, selectedRow };
  }

  public async reset(input: {
    acknowledgement: boolean;
    confirmation: string;
  }): Promise<{ executionYear: number }> {
    const year = campaignYearInKolkata(this.now());
    if (!input.acknowledgement || input.confirmation !== `RESET MEGA DRAW ${year}`)
      throw new MegaDrawError('VALIDATION_ERROR', 'Mega Draw reset confirmation is required.');
    const current = await this.currentEpoch(year);
    const state = await this.readValue<MegaDrawLifecycle>(year, scoped(current, 'STATE'));
    if (state?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    const next: CurrentEpoch = { epoch: randomUUID() };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { pk: key(year), sk: 'CURRENT' },
                ConditionExpression: 'attribute_not_exists(pk) OR #value.#epoch = :epoch',
                UpdateExpression:
                  'SET #value = :next, entityType = :entityType, updatedAt = :updatedAt',
                ExpressionAttributeNames: { '#value': 'value', '#epoch': 'epoch' },
                ExpressionAttributeValues: {
                  ':epoch': current,
                  ':next': next,
                  ':entityType': 'MEGA_CURRENT_EPOCH',
                  ':updatedAt': this.now().toISOString(),
                },
              },
            },
          ],
        }),
      );
    } catch {
      throw new MegaDrawError('MEGA_DRAW_IN_PROGRESS', 'Mega Draw state changed while resetting.');
    }
    void this.cleanupPriorEpochs(year, next.epoch).catch(() => undefined);
    return { executionYear: year };
  }

  public async close(input: {
    acknowledgement: boolean;
    confirmation: string;
  }): Promise<{ lifecycle: MegaDrawLifecycle }> {
    const year = campaignYearInKolkata(this.now());
    if (!input.acknowledgement || input.confirmation !== `CLOSE MEGA DRAW ${year}`)
      throw new MegaDrawError('VALIDATION_ERROR', 'Mega Draw close confirmation is required.');
    const current = await this.currentEpoch(year);
    const lifecycle = await this.readValue<MegaDrawLifecycle>(year, scoped(current, 'STATE'));
    if (!lifecycle || lifecycle.status !== 'COMPLETED')
      throw new MegaDrawError(
        'MEGA_DRAW_NOT_CONFIGURED',
        'Mega Draw must be completed before closing.',
      );
    const closed = { ...lifecycle, status: 'CLOSED' as const, closedAt: this.now().toISOString() };
    const history = (await this.readValue<MegaDrawHistory[]>(year, 'HISTORY')) ?? [];
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: { pk: key(year), sk: 'CURRENT' },
                ConditionExpression: 'attribute_not_exists(pk) OR #value.#epoch = :epoch',
                ExpressionAttributeNames: { '#value': 'value', '#epoch': 'epoch' },
                ExpressionAttributeValues: { ':epoch': current },
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: { pk: key(year), sk: scoped(current, 'STATE') },
                ConditionExpression: '#value.#reference = :reference AND #value.#status = :status',
                UpdateExpression: 'SET #value = :value, updatedAt = :updatedAt',
                ExpressionAttributeNames: {
                  '#value': 'value',
                  '#reference': 'reference',
                  '#status': 'status',
                },
                ExpressionAttributeValues: {
                  ':reference': lifecycle.reference,
                  ':status': 'COMPLETED',
                  ':value': closed,
                  ':updatedAt': this.now().toISOString(),
                },
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: retained(year, 'HISTORY', 'MEGA_HISTORY', [...history, closed]),
              },
            },
          ],
        }),
      );
    } catch {
      throw new MegaDrawError('MEGA_DRAW_IN_PROGRESS', 'Mega Draw state changed while closing.');
    }
    return { lifecycle: closed };
  }

  public async reopen(): Promise<{ executionYear: number; cycleNumber: number }> {
    const year = campaignYearInKolkata(this.now());
    const current = await this.currentEpoch(year);
    const state = await this.readValue<MegaDrawLifecycle>(year, scoped(current, 'STATE'));
    if (!state || state.status !== 'CLOSED')
      throw new MegaDrawError(
        'MEGA_DRAW_REOPEN_NOT_ALLOWED',
        'A new Mega Draw cycle can be created only after closing the current cycle.',
      );
    const history = (await this.readValue<MegaDrawHistory[]>(year, 'HISTORY')) ?? [];
    const next = { epoch: randomUUID() };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk: key(year), sk: 'CURRENT' },
              ConditionExpression: '#value.#epoch = :epoch',
              UpdateExpression: 'SET #value = :next, updatedAt = :updatedAt',
              ExpressionAttributeNames: { '#value': 'value', '#epoch': 'epoch' },
              ExpressionAttributeValues: {
                ':epoch': current,
                ':next': next,
                ':updatedAt': this.now().toISOString(),
              },
            },
          },
        ],
      }),
    );
    return { executionYear: year, cycleNumber: history.length + 1 };
  }

  private async startFromPreflight(
    reference: string | undefined,
    year: number,
    current: string,
  ): Promise<MegaDrawLifecycle> {
    const preflight = reference
      ? await this.readValue<StoredPreflight>(year, scoped(current, `PREFLIGHT#${reference}`))
      : undefined;
    if (
      !preflight ||
      preflight.executionYear !== year ||
      epoch(preflight.expiresAt) <= epoch(this.now().toISOString()) ||
      preflight.fingerprint !== fingerprint(await this.currentContext())
    )
      throw stale();
    if (preflight.candidates.length < preflight.prizes.length) throw insufficient();
    const history = (await this.readValue<MegaDrawHistory[]>(year, 'HISTORY')) ?? [];
    return {
      reference: `MD-${year}-${randomUUID()}`,
      executionYear: year,
      cycleNumber: history.length + 1,
      status: 'SETUP',
      campaign: preflight.campaign,
      prizes: preflight.prizes,
      candidates: preflight.candidates,
      selectedRows: [],
      nextPrizeOrdinal: preflight.prizes.length,
      remainingPrizes: [...preflight.prizes].reverse(),
    };
  }

  private async currentContext(): Promise<{
    year: number;
    campaign: MegaCampaignSnapshot;
    prizes: MegaPrize[];
    candidates: MegaCandidate[];
  }> {
    const year = campaignYearInKolkata(this.now());
    const [campaign, prizes, claims, history] = await Promise.all([
      this.drawStore.getCampaign(),
      this.readValue<MegaPrize[]>(year, 'CONFIG'),
      this.drawStore.listActiveClaims(),
      this.readValue<MegaDrawHistory[]>(year, 'HISTORY'),
    ]);
    if (!campaign || Number(campaign.fromDate.slice(0, 4)) !== year)
      throw new MegaDrawError(
        'CAMPAIGN_NOT_FOUND',
        'Campaign configuration was not found for this year.',
      );
    if (campaign.status !== 'ENDED')
      throw new MegaDrawError('CAMPAIGN_NOT_ENDED', 'The campaign has not ended.');
    if (!prizes || prizes.length === 0)
      throw new MegaDrawError(
        'MEGA_DRAW_NOT_CONFIGURED',
        'Configure Mega Draw prizes before continuing.',
      );
    const candidates = new Map<string, MegaCandidate>();
    for (const claim of claims) {
      if (campaignYearInKolkata(new Date(claim.claimTimestamp)) !== year) continue;
      const normalizedPhone = claim.phone.replace(/\D/g, '');
      const identity = `${claim.billNumberNormalized}#${normalizedPhone}`;
      if (!candidates.has(identity))
        candidates.set(identity, {
          identity,
          normalizedBillNumber: claim.billNumberNormalized,
          normalizedPhone,
          sourceClaimId: claim.claimId,
          sourceClaimTimestamp: claim.claimTimestamp,
          customerName: claim.customerName,
          maskedPhone: `*****${normalizedPhone.slice(-4)}`,
          billNumber: claim.billNumberDisplay,
        });
    }
    const historicalWinners = new Set(
      (history ?? []).flatMap((cycle) => cycle.selectedRows.map((row) => row.candidate.identity)),
    );
    return {
      year,
      campaign: {
        id: campaign.id,
        fromDate: campaign.fromDate,
        toDate: campaign.toDate,
        timezone: 'Asia/Kolkata',
        ended: true,
      },
      prizes,
      candidates: [...candidates.values()].filter(
        (candidate) => !historicalWinners.has(candidate.identity),
      ),
    };
  }

  private async readValue<T>(year: number, sk: string): Promise<T | undefined> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: key(year), sk } }),
    );
    return (response as { Item?: MegaItem }).Item?.value as T | undefined;
  }

  private async currentEpoch(year: number): Promise<string> {
    return (await this.readValue<CurrentEpoch>(year, 'CURRENT'))?.epoch ?? 'initial';
  }

  private async cleanupPriorEpochs(year: number, current: string): Promise<void> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': key(year) },
        Limit: 24,
      }),
    );
    const items = (response as { Items?: MegaItem[] }).Items ?? [];
    const stale = items.filter(
      (item) =>
        item.sk !== 'CURRENT' && item.sk !== 'CONFIG' && !item.sk.startsWith(`EPOCH#${current}#`),
    );
    if (stale.length > 0)
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: stale.map((item) => ({
            Delete: { TableName: this.tableName, Key: { pk: item.pk, sk: item.sk } },
          })),
        }),
      );
  }
}

const key = (year: number): string => `MEGA#${year}`;
const scoped = (current: string, sk: string): string => `EPOCH#${current}#${sk}`;
const idempotencyStorageKey = (operatorSubject: string, idempotencyKey: string): string =>
  `IDEMP#${operatorSubject}#${idempotencyKey}`;
const epoch = (value: string): number => Math.floor(new Date(value).getTime() / 1000);
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const retained = (year: number, sk: string, entityType: string, value: unknown): MegaItem => ({
  pk: key(year),
  sk,
  entityType,
  value,
  expiresAt: Math.floor(Date.now() / 1000) + RETENTION_SECONDS,
});
const stale = (): MegaDrawError =>
  new MegaDrawError('PREFLIGHT_STALE', 'The Mega Draw preflight is no longer current.');
const insufficient = (): MegaDrawError =>
  new MegaDrawError(
    'INSUFFICIENT_ELIGIBLE_PARTICIPANTS',
    'There are not enough eligible participants.',
  );
const publicPreflight = (preflight: StoredPreflight): MegaPreflight => ({
  reference: preflight.reference,
  executionYear: preflight.executionYear,
  expiresAt: preflight.expiresAt,
  candidateCount: preflight.candidateCount,
  prizes: preflight.prizes,
  campaign: preflight.campaign,
});
const validatePrizes = (names: string[]): MegaPrize[] => {
  if (names.length < 1 || names.length > 10)
    throw new MegaDrawError('VALIDATION_ERROR', 'Configure between 1 and 10 Mega prizes.');
  const normalized = names.map((name) => name.trim());
  if (
    normalized.some((name) => name.length === 0 || name.length > 100) ||
    new Set(normalized.map((name) => name.toLocaleLowerCase())).size !== normalized.length
  )
    throw new MegaDrawError(
      'VALIDATION_ERROR',
      'Mega prize names must be unique and 1 to 100 characters.',
    );
  return normalized.map((name, index) => ({ position: index + 1, name }));
};
const selectNext = (
  lifecycle: MegaDrawLifecycle,
  secureIndex: (upperExclusive: number) => number,
  now: () => Date,
): MegaSelectedRow => {
  const prize = lifecycle.prizes?.[lifecycle.nextPrizeOrdinal - 1];
  const candidates = lifecycle.candidates;
  if (!prize || !candidates)
    throw new MegaDrawError('MEGA_DRAW_ALREADY_COMPLETED', 'Mega Draw has already completed.');
  const selected = new Set(lifecycle.selectedRows.map((row) => row.candidate.identity));
  const pool = candidates.filter((candidate) => !selected.has(candidate.identity));
  const candidate = pool[secureIndex(pool.length)];
  if (!candidate) throw insufficient();
  return {
    prize,
    candidate,
    selectedAt: now().toISOString(),
    candidatePoolCount: pool.length,
    sourceClaimStatus: 'ACTIVE',
  };
};
const advance = (
  lifecycle: MegaDrawLifecycle,
  selectedRow: MegaSelectedRow,
  now: () => Date,
): MegaDrawLifecycle => {
  const selectedRows = [...lifecycle.selectedRows, selectedRow];
  const nextPrizeOrdinal = lifecycle.nextPrizeOrdinal - 1;
  const remainingPrizes = (lifecycle.prizes ?? []).slice(0, nextPrizeOrdinal).reverse();
  const completed = remainingPrizes.length === 0;
  return {
    ...lifecycle,
    selectedRows,
    nextPrizeOrdinal,
    remainingPrizes,
    status: completed ? 'COMPLETED' : 'IN_PROGRESS',
    ...(completed ? { completedAt: now().toISOString() } : {}),
  };
};
const recoverDrawNext = (
  execution: Execution,
  requestFingerprint: string,
): { lifecycle: MegaDrawLifecycle; selectedRow: MegaSelectedRow } => {
  if (execution.fingerprint !== requestFingerprint)
    throw new MegaDrawError(
      'VALIDATION_ERROR',
      'Idempotency key cannot be reused for a different request.',
    );
  if (!execution.selectedRow)
    throw new MegaDrawError('MEGA_DRAW_IN_PROGRESS', 'Mega Draw execution is in progress.');
  return { lifecycle: execution.lifecycle, selectedRow: execution.selectedRow };
};

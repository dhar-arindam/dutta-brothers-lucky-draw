import { createHash, randomInt } from 'node:crypto';

import { campaignYearInKolkata } from './campaign.js';
import type { Claim } from './domain.js';
import type { CampaignView } from './store.js';

export type MegaDrawErrorCode =
  | 'MEGA_DRAW_NOT_CONFIGURED'
  | 'MEGA_DRAW_CONFIGURATION_LOCKED'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_NOT_ENDED'
  | 'INSUFFICIENT_ELIGIBLE_PARTICIPANTS'
  | 'PREFLIGHT_STALE'
  | 'MEGA_DRAW_IN_PROGRESS'
  | 'MEGA_DRAW_ALREADY_COMPLETED'
  | 'MEGA_DRAW_CLOSED'
  | 'MEGA_DRAW_REOPEN_NOT_ALLOWED'
  | 'VALIDATION_ERROR';
export class MegaDrawError extends Error {
  public constructor(
    public readonly code: MegaDrawErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MegaDrawError';
  }
}
export interface MegaPrize {
  position: number;
  name: string;
}
export interface MegaCandidate {
  identity: string;
  normalizedBillNumber: string;
  normalizedPhone: string;
  sourceClaimId: string;
  sourceClaimTimestamp: string;
  customerName: string;
  maskedPhone: string;
  billNumber: string;
}
export interface MegaCampaignSnapshot {
  id: string;
  fromDate: string;
  toDate: string;
  timezone: 'Asia/Kolkata';
  ended: true;
}
export interface MegaSelectedRow {
  prize: MegaPrize;
  candidate: MegaCandidate;
  selectedAt: string;
  candidatePoolCount: number;
  sourceClaimStatus: 'ACTIVE' | 'SOURCE_CLAIM_ARCHIVED';
}
export interface MegaDrawLifecycle {
  reference: string;
  executionYear: number;
  cycleNumber: number;
  status: 'SETUP' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
  campaign?: MegaCampaignSnapshot;
  prizes?: MegaPrize[];
  candidates?: MegaCandidate[];
  selectedRows: MegaSelectedRow[];
  nextPrizeOrdinal: number;
  remainingPrizes: MegaPrize[];
  completedAt?: string;
  closedAt?: string;
}
export type MegaDrawHistory = Pick<
  MegaDrawLifecycle,
  'reference' | 'executionYear' | 'cycleNumber' | 'selectedRows' | 'completedAt' | 'closedAt'
> & { status: 'CLOSED' };
export interface MegaDrawExecutionStatus {
  execution: 'NOT_FOUND' | 'IN_PROGRESS' | 'COMPLETED';
  operation?: 'DRAW_NEXT';
  lifecycle?: MegaDrawLifecycle;
  selectedRow?: MegaSelectedRow;
}
export interface MegaPreflight {
  reference: string;
  executionYear: number;
  expiresAt: string;
  candidateCount: number;
  prizes: MegaPrize[];
  campaign: MegaCampaignSnapshot;
}
interface StoredPreflight extends MegaPreflight {
  fingerprint: string;
  candidates: MegaCandidate[];
}
interface Execution {
  fingerprint: string;
  operation: 'DRAW_NEXT';
  lifecycle: MegaDrawLifecycle;
  selectedRow?: MegaSelectedRow;
}
export interface MegaDrawDataSource {
  getCampaign(): CampaignView | undefined;
  listActiveClaims(): Claim[];
}

export class MegaDrawService {
  private readonly configurations = new Map<string, MegaPrize[]>();
  private readonly preflights = new Map<string, StoredPreflight>();
  private readonly lifecycles = new Map<string, MegaDrawLifecycle>();
  private readonly executions = new Map<string, Execution>();
  private readonly epochs = new Map<number, number>();
  private readonly histories = new Map<number, MegaDrawHistory[]>();
  private referenceSequence = 0;

  public constructor(
    private readonly source: MegaDrawDataSource,
    private readonly now: () => Date = () => new Date(),
    private readonly secureIndex: (upperExclusive: number) => number = randomInt,
  ) {}

  public get(executionYear = campaignYearInKolkata(this.now())): {
    configuration: MegaPrize[];
    lifecycle?: MegaDrawLifecycle;
    history: MegaDrawHistory[];
  } {
    const epoch = this.currentEpoch(executionYear);
    const lifecycle = this.lifecycles.get(this.epochKey(executionYear, epoch));
    return {
      configuration: [...(this.configurations.get(this.configurationKey(executionYear)) ?? [])],
      ...(lifecycle ? { lifecycle } : {}),
      history: [...(this.histories.get(executionYear) ?? [])].reverse(),
    };
  }
  public status(idempotencyKey: string, operatorSubject: string): MegaDrawExecutionStatus {
    const year = campaignYearInKolkata(this.now());
    const execution = this.executions.get(
      this.executionKey(year, this.currentEpoch(year), operatorSubject, idempotencyKey),
    );
    return execution
      ? {
          execution: 'COMPLETED',
          operation: execution.operation,
          lifecycle: execution.lifecycle,
          ...(execution.selectedRow ? { selectedRow: execution.selectedRow } : {}),
        }
      : { execution: 'NOT_FOUND' };
  }
  public configure(prizeNames: string[]): MegaPrize[] {
    const year = campaignYearInKolkata(this.now());
    const epoch = this.currentEpoch(year);
    const lifecycle = this.lifecycles.get(this.epochKey(year, epoch));
    if (lifecycle?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    if (lifecycle && lifecycle.status !== 'SETUP')
      throw new MegaDrawError(
        'MEGA_DRAW_CONFIGURATION_LOCKED',
        'Mega Draw configuration is locked after the first selection.',
      );
    const prizes = validatePrizes(prizeNames);
    this.configurations.set(this.configurationKey(year), prizes);
    return [...prizes];
  }
  public preflight(): MegaPreflight {
    const year = campaignYearInKolkata(this.now());
    const lifecycle = this.lifecycles.get(this.epochKey(year, this.currentEpoch(year)));
    if (lifecycle?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    const context = this.currentContext();
    const preflight: StoredPreflight = {
      reference: this.nextReference(context.year),
      executionYear: context.year,
      expiresAt: new Date(this.now().getTime() + 300_000).toISOString(),
      candidateCount: context.candidates.length,
      prizes: context.prizes,
      campaign: context.campaign,
      candidates: context.candidates,
      fingerprint: fingerprint(context),
    };
    this.preflights.set(
      this.preflightKey(context.year, this.currentEpoch(context.year), preflight.reference),
      preflight,
    );
    return publicPreflight(preflight);
  }
  public drawNext(input: {
    preflightReference?: string;
    idempotencyKey: string;
    operatorSubject: string;
    acknowledgement?: boolean;
    confirmation?: string;
  }): { lifecycle: MegaDrawLifecycle; selectedRow: MegaSelectedRow } {
    const year = campaignYearInKolkata(this.now());
    const epoch = this.currentEpoch(year);
    const existing = this.lifecycles.get(this.epochKey(year, epoch));
    if (existing?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    if (existing?.status === 'COMPLETED')
      throw new MegaDrawError('MEGA_DRAW_ALREADY_COMPLETED', 'Mega Draw has already completed.');
    const requestFingerprint = fingerprint({
      operation: 'DRAW_NEXT',
      preflightReference: input.preflightReference,
      acknowledgement: input.acknowledgement ?? true,
      confirmation: input.confirmation ?? `DRAW NEXT MEGA PRIZE ${year}`,
    });
    const executionKey = this.executionKey(
      year,
      epoch,
      input.operatorSubject,
      input.idempotencyKey,
    );
    const prior = this.executions.get(executionKey);
    if (prior) {
      if (prior.fingerprint !== requestFingerprint)
        throw new MegaDrawError(
          'VALIDATION_ERROR',
          'Idempotency key cannot be reused for a different request.',
        );
      if (!prior.selectedRow)
        throw new MegaDrawError('MEGA_DRAW_IN_PROGRESS', 'Mega Draw execution is in progress.');
      return { lifecycle: prior.lifecycle, selectedRow: prior.selectedRow };
    }
    const lifecycle = existing ?? this.startFromPreflight(input.preflightReference, year);
    const ordinal = lifecycle.nextPrizeOrdinal;
    const prize = lifecycle.prizes?.[ordinal - 1];
    const candidates = lifecycle.candidates;
    if (!prize || !candidates)
      throw new MegaDrawError('MEGA_DRAW_ALREADY_COMPLETED', 'Mega Draw has already completed.');
    const selected = new Set(lifecycle.selectedRows.map((row) => row.candidate.identity));
    const pool = candidates.filter((candidate) => !selected.has(candidate.identity));
    const candidate = pool[this.secureIndex(pool.length)];
    if (!candidate) throw insufficient();
    const selectedRow: MegaSelectedRow = {
      prize,
      candidate,
      selectedAt: this.now().toISOString(),
      candidatePoolCount: pool.length,
      sourceClaimStatus: 'ACTIVE',
    };
    const selectedRows = [...lifecycle.selectedRows, selectedRow];
    const nextPrizeOrdinal = ordinal - 1;
    const remainingPrizes = (lifecycle.prizes ?? []).slice(0, nextPrizeOrdinal).reverse();
    const completed = remainingPrizes.length === 0;
    const updated: MegaDrawLifecycle = {
      ...lifecycle,
      selectedRows,
      nextPrizeOrdinal,
      remainingPrizes,
      status: completed ? 'COMPLETED' : 'IN_PROGRESS',
      ...(completed ? { completedAt: this.now().toISOString() } : {}),
    };
    this.lifecycles.set(this.epochKey(year, epoch), updated);
    this.executions.set(executionKey, {
      fingerprint: requestFingerprint,
      operation: 'DRAW_NEXT',
      lifecycle: updated,
      selectedRow,
    });
    return { lifecycle: updated, selectedRow };
  }
  public reset(input: { acknowledgement: boolean; confirmation: string }): {
    executionYear: number;
  } {
    const year = campaignYearInKolkata(this.now());
    if (!input.acknowledgement || input.confirmation !== `RESET MEGA DRAW ${year}`)
      throw new MegaDrawError('VALIDATION_ERROR', 'Mega Draw reset confirmation is required.');
    if (this.lifecycles.get(this.epochKey(year, this.currentEpoch(year)))?.status === 'CLOSED')
      throw new MegaDrawError('MEGA_DRAW_CLOSED', 'Mega Draw is closed.');
    this.epochs.set(year, this.currentEpoch(year) + 1);
    return { executionYear: year };
  }
  public close(input: { acknowledgement: boolean; confirmation: string }): {
    lifecycle: MegaDrawLifecycle;
  } {
    const year = campaignYearInKolkata(this.now());
    if (!input.acknowledgement || input.confirmation !== `CLOSE MEGA DRAW ${year}`)
      throw new MegaDrawError('VALIDATION_ERROR', 'Mega Draw close confirmation is required.');
    const key = this.epochKey(year, this.currentEpoch(year));
    const lifecycle = this.lifecycles.get(key);
    if (!lifecycle || lifecycle.status !== 'COMPLETED')
      throw new MegaDrawError(
        'MEGA_DRAW_NOT_CONFIGURED',
        'Mega Draw must be completed before closing.',
      );
    const closed = { ...lifecycle, status: 'CLOSED' as const, closedAt: this.now().toISOString() };
    this.lifecycles.set(key, closed);
    const history = this.histories.get(year) ?? [];
    this.histories.set(year, [...history, closed]);
    return { lifecycle: closed };
  }
  public reopen(): { executionYear: number; cycleNumber: number } {
    const year = campaignYearInKolkata(this.now());
    const current = this.lifecycles.get(this.epochKey(year, this.currentEpoch(year)));
    if (!current || current.status !== 'CLOSED')
      throw new MegaDrawError(
        'MEGA_DRAW_REOPEN_NOT_ALLOWED',
        'A new Mega Draw cycle can be created only after closing the current cycle.',
      );
    this.epochs.set(year, this.currentEpoch(year) + 1);
    return { executionYear: year, cycleNumber: current.cycleNumber + 1 };
  }
  private startFromPreflight(reference: string | undefined, year: number): MegaDrawLifecycle {
    const preflight = reference
      ? this.preflights.get(this.preflightKey(year, this.currentEpoch(year), reference))
      : undefined;
    if (
      !preflight ||
      preflight.executionYear !== year ||
      new Date(preflight.expiresAt) <= this.now() ||
      preflight.fingerprint !== fingerprint(this.currentContext())
    )
      throw stale();
    if (preflight.candidates.length < preflight.prizes.length) throw insufficient();
    return {
      reference: this.nextReference(year),
      executionYear: year,
      cycleNumber: (this.histories.get(year)?.length ?? 0) + 1,
      status: 'SETUP',
      campaign: preflight.campaign,
      prizes: [...preflight.prizes],
      candidates: [...preflight.candidates],
      selectedRows: [],
      nextPrizeOrdinal: preflight.prizes.length,
      remainingPrizes: [...preflight.prizes].reverse(),
    };
  }
  private currentContext(): {
    year: number;
    campaign: MegaCampaignSnapshot;
    prizes: MegaPrize[];
    candidates: MegaCandidate[];
  } {
    const year = campaignYearInKolkata(this.now());
    const campaign = this.source.getCampaign();
    const configuration = this.configurations.get(this.configurationKey(year)) ?? [];
    if (!campaign || Number(campaign.fromDate.slice(0, 4)) !== year)
      throw new MegaDrawError(
        'CAMPAIGN_NOT_FOUND',
        'Campaign configuration was not found for this year.',
      );
    if (campaign.status !== 'ENDED')
      throw new MegaDrawError('CAMPAIGN_NOT_ENDED', 'The campaign has not ended.');
    if (configuration.length === 0)
      throw new MegaDrawError(
        'MEGA_DRAW_NOT_CONFIGURED',
        'Configure Mega Draw prizes before continuing.',
      );
    const candidates = new Map<string, MegaCandidate>();
    for (const claim of this.source.listActiveClaims()) {
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
      (this.histories.get(year) ?? []).flatMap((history) =>
        history.selectedRows.map((row) => row.candidate.identity),
      ),
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
      prizes: [...configuration],
      candidates: [...candidates.values()].filter(
        (candidate) => !historicalWinners.has(candidate.identity),
      ),
    };
  }
  private nextReference(year: number): string {
    return `MD-${year}-${(++this.referenceSequence).toString().padStart(6, '0')}`;
  }
  private currentEpoch(year: number): number {
    return this.epochs.get(year) ?? 0;
  }
  private epochKey(year: number, epoch: number): string {
    return `${year}:${epoch}`;
  }
  private configurationKey(year: number): string {
    return `${year}:configuration`;
  }
  private preflightKey(year: number, epoch: number, reference: string): string {
    return `${this.epochKey(year, epoch)}:${reference}`;
  }
  private executionKey(
    year: number,
    epoch: number,
    subject: string,
    idempotencyKey: string,
  ): string {
    return `${this.epochKey(year, epoch)}:${subject}:${idempotencyKey}`;
  }
}
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
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

/* Obsolete pre-sequential implementation retained by a failed editor replace.

import { campaignYearInKolkata } from './campaign.js';
import type { Claim } from './domain.js';
import type { CampaignView } from './store.js';

export type MegaDrawErrorCode =
  | 'MEGA_DRAW_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_NOT_ENDED'
  | 'INSUFFICIENT_ELIGIBLE_PARTICIPANTS'
  | 'PREFLIGHT_STALE'
  | 'MEGA_DRAW_IN_PROGRESS'
  | 'MEGA_DRAW_ALREADY_COMPLETED'
  | 'VALIDATION_ERROR';

export class MegaDrawError extends Error {
  public constructor(public readonly code: MegaDrawErrorCode, message: string) {
    super(message);
    this.name = 'MegaDrawError';
  }
}

export interface MegaPrize {
  position: number;
  name: string;
}

export interface MegaCandidate {
  identity: string;
  normalizedBillNumber: string;
  normalizedPhone: string;
  sourceClaimId: string;
  sourceClaimTimestamp: string;
  customerName: string;
  maskedPhone: string;
  billNumber: string;
}

export interface MegaCampaignSnapshot {
  id: string;
  fromDate: string;
  toDate: string;
  timezone: 'Asia/Kolkata';
  ended: true;
}

export interface MegaDrawResult {
  reference: string;
  executionYear: number;
  status: 'FINALIZED' | 'SOURCE_CLAIM_ARCHIVED';
  completedAt: string;
  campaign: MegaCampaignSnapshot;
  prizes: MegaPrize[];
  candidates: MegaCandidate[];
  winners: Array<{ prize: MegaPrize; candidate: MegaCandidate }>;
  supersedesReference?: string;
}

export interface MegaDrawHistoricalResult {
  result: MegaDrawResult;
  replacementReference: string;
}

export interface MegaDrawExecutionStatus {
  execution: 'NOT_FOUND' | 'IN_PROGRESS' | 'FINALIZED';
  operation?: 'EXECUTE' | 'VOID_AND_REDRAW';
  result?: MegaDrawResult;
}

export interface MegaPreflight {
  reference: string;
  executionYear: number;
  expiresAt: string;
  candidateCount: number;
  prizes: MegaPrize[];
  campaign: MegaCampaignSnapshot;
}

interface StoredPreflight extends MegaPreflight {
  fingerprint: string;
  candidates: MegaCandidate[];
}

export interface MegaDrawDataSource {
  getCampaign(): CampaignView | undefined;
  listActiveClaims(): Claim[];
}

export class MegaDrawService {
  private readonly configuration: MegaPrize[] = [];
  private readonly preflights = new Map<string, StoredPreflight>();
  private readonly resultsByYear = new Map<number, MegaDrawResult>();
  private readonly historicalResultsByYear = new Map<number, MegaDrawResult[]>();
  private readonly idempotentResults = new Map<string, { fingerprint: string; operation: 'EXECUTE' | 'VOID_AND_REDRAW'; result: MegaDrawResult }>();
  private referenceSequence = 0;

  public constructor(
    private readonly source: MegaDrawDataSource,
    private readonly now: () => Date = () => new Date(),
    private readonly secureIndex: (upperExclusive: number) => number = randomInt,
  ) {}

  public get(executionYear = campaignYearInKolkata(this.now())): {
    configuration: MegaPrize[];
    result?: MegaDrawResult;
    voidedResults: MegaDrawHistoricalResult[];
  } {
    const result = this.resultsByYear.get(executionYear);
    const voidedResults = (this.historicalResultsByYear.get(executionYear) ?? []).map((historicalResult) => ({
      result: historicalResult,
      replacementReference: this.resultsByYear.get(executionYear)?.reference ?? '',
    }));
    return result
      ? { configuration: [...this.configuration], result, voidedResults }
      : { configuration: [...this.configuration], voidedResults };
  }

  public status(idempotencyKey: string, operatorSubject: string): MegaDrawExecutionStatus {
    const year = campaignYearInKolkata(this.now());
    const record = this.idempotentResults.get(`${year}:${operatorSubject}:${idempotencyKey}`);
    return record
      ? { execution: 'FINALIZED', operation: record.operation, result: record.result }
      : { execution: 'NOT_FOUND' };
  }

  public configure(prizeNames: string[]): MegaPrize[] {
    if (this.resultsByYear.has(campaignYearInKolkata(this.now()))) {
      throw new MegaDrawError('MEGA_DRAW_ALREADY_COMPLETED', 'Mega Draw has already completed.');
    }
    if (prizeNames.length < 1 || prizeNames.length > 10) {
      throw new MegaDrawError('VALIDATION_ERROR', 'Configure between 1 and 10 Mega prizes.');
    }

    const normalized = prizeNames.map((name) => name.trim());
    if (normalized.some((name) => name.length === 0 || name.length > 100)) {
      throw new MegaDrawError('VALIDATION_ERROR', 'Each Mega prize name must be 1 to 100 characters.');
    }
    if (new Set(normalized.map((name) => name.toLocaleLowerCase())).size !== normalized.length) {
      throw new MegaDrawError('VALIDATION_ERROR', 'Mega prize names must be unique.');
    }

    this.configuration.splice(0, this.configuration.length, ...normalized.map((name, index) => ({
      position: index + 1,
      name,
    })));
    return [...this.configuration];
  }

  public preflight(): MegaPreflight {
    const context = this.currentContext();
    const reference = `MD-${context.year}-${(++this.referenceSequence).toString().padStart(6, '0')}`;
    const expiresAt = new Date(this.now().getTime() + 5 * 60 * 1000).toISOString();
    const preflight: StoredPreflight = {
      reference,
      executionYear: context.year,
      expiresAt,
      candidateCount: context.candidates.length,
      prizes: context.prizes,
      campaign: context.campaign,
      candidates: context.candidates,
      fingerprint: fingerprint(context),
    };
    this.preflights.set(reference, preflight);
    return toPreflight(preflight);
  }

  public execute(input: {
    preflightReference: string;
    idempotencyKey: string;
    operatorSubject: string;
    acknowledgement: boolean;
    confirmation: string;
  }): MegaDrawResult {
    const preflight = this.preflights.get(input.preflightReference);
    if (!preflight) {
      throw new MegaDrawError('PREFLIGHT_STALE', 'The Mega Draw preflight is no longer current.');
    }
    const requestFingerprint = fingerprint({ preflightReference: input.preflightReference, operatorSubject: input.operatorSubject });
    const idempotencyIdentity = `${preflight.executionYear}:${input.operatorSubject}:${input.idempotencyKey}`;
    const previous = this.idempotentResults.get(idempotencyIdentity);
    if (previous) {
      if (previous.fingerprint !== requestFingerprint) {
        throw new MegaDrawError('VALIDATION_ERROR', 'Idempotency key cannot be reused for a different request.');
      }
      return previous.result;
    }
    if (!input.acknowledgement || input.confirmation !== `RUN MEGA DRAW ${preflight.executionYear}`) {
      throw new MegaDrawError('VALIDATION_ERROR', 'Mega Draw confirmation is required.');
    }
    const existing = this.resultsByYear.get(preflight.executionYear);
    if (existing) {
      this.idempotentResults.set(idempotencyIdentity, { fingerprint: requestFingerprint, operation: 'EXECUTE', result: existing });
      return existing;
    }
    if (new Date(preflight.expiresAt) <= this.now() || preflight.fingerprint !== fingerprint(this.currentContext())) {
      throw new MegaDrawError('PREFLIGHT_STALE', 'The Mega Draw preflight is no longer current.');
    }
    if (preflight.candidates.length < preflight.prizes.length) {
      throw new MegaDrawError('INSUFFICIENT_ELIGIBLE_PARTICIPANTS', 'There are not enough eligible participants.');
    }

    const result = this.finalize(preflight, this.select(preflight.candidates, preflight.prizes));
    this.resultsByYear.set(preflight.executionYear, result);
    this.idempotentResults.set(idempotencyIdentity, { fingerprint: requestFingerprint, operation: 'EXECUTE', result });
    return result;
  }

  public voidAndRedraw(input: {
    idempotencyKey: string;
    operatorSubject: string;
    acknowledgement: boolean;
    confirmation: string;
    reason: string;
  }): MegaDrawResult {
    const year = campaignYearInKolkata(this.now());
    const idempotencyIdentity = `${year}:${input.operatorSubject}:${input.idempotencyKey}`;
    const requestFingerprint = fingerprint({ operation: 'VOID_AND_REDRAW', operatorSubject: input.operatorSubject, acknowledgement: input.acknowledgement, confirmation: input.confirmation, reason: input.reason.trim() });
    const previous = this.idempotentResults.get(idempotencyIdentity);
    if (previous) {
      if (previous.fingerprint !== requestFingerprint) {
        throw new MegaDrawError('VALIDATION_ERROR', 'Idempotency key cannot be reused for a different request.');
      }
      return previous.result;
    }
    const original = this.resultsByYear.get(year);
    if (!original) {
      throw new MegaDrawError('MEGA_DRAW_NOT_CONFIGURED', 'No finalized Mega Draw exists for this year.');
    }
    if (!input.acknowledgement || input.confirmation !== `VOID AND REDRAW MEGA DRAW ${year}` || input.reason.trim().length < 10 || input.reason.trim().length > 500) {
      throw new MegaDrawError('VALIDATION_ERROR', 'Void and redraw confirmation and reason are required.');
    }
    const priorWinnerIdentities = new Set(original.winners.map((winner) => winner.candidate.identity));
    const remaining = original.candidates.filter((candidate) => !priorWinnerIdentities.has(candidate.identity));
    if (remaining.length < original.prizes.length) {
      throw new MegaDrawError('INSUFFICIENT_ELIGIBLE_PARTICIPANTS', 'There are not enough eligible participants.');
    }
    const replacement = this.finalize(
      {
        reference: this.nextReference(year),
        executionYear: year,
        campaign: original.campaign,
        prizes: original.prizes,
        candidates: original.candidates,
      },
      this.select(remaining, original.prizes),
      original.reference,
    );
    this.resultsByYear.set(year, replacement);
    this.historicalResultsByYear.set(year, [...(this.historicalResultsByYear.get(year) ?? []), original]);
    this.idempotentResults.set(idempotencyIdentity, { fingerprint: requestFingerprint, operation: 'VOID_AND_REDRAW', result: replacement });
    return replacement;
  }

  private currentContext(): { year: number; campaign: MegaCampaignSnapshot; prizes: MegaPrize[]; candidates: MegaCandidate[] } {
    const year = campaignYearInKolkata(this.now());
    const campaign = this.source.getCampaign();
    if (!campaign || Number(campaign.fromDate.slice(0, 4)) !== year) {
      throw new MegaDrawError('CAMPAIGN_NOT_FOUND', 'Campaign configuration was not found for this year.');
    }
    if (campaign.status !== 'ENDED') {
      throw new MegaDrawError('CAMPAIGN_NOT_ENDED', 'The campaign has not ended.');
    }
    if (this.configuration.length === 0) {
      throw new MegaDrawError('MEGA_DRAW_NOT_CONFIGURED', 'Configure Mega Draw prizes before continuing.');
    }
    const candidates = new Map<string, MegaCandidate>();
    for (const claim of this.source.listActiveClaims()) {
      if (campaignYearInKolkata(new Date(claim.claimTimestamp)) !== year) continue;
      const normalizedPhone = claim.phone.replace(/\D/g, '');
      const identity = `${claim.billNumberNormalized}#${normalizedPhone}`;
      if (!candidates.has(identity)) {
        candidates.set(identity, { identity, normalizedBillNumber: claim.billNumberNormalized, normalizedPhone, sourceClaimId: claim.claimId, sourceClaimTimestamp: claim.claimTimestamp, customerName: claim.customerName, maskedPhone: `*****${normalizedPhone.slice(-4)}`, billNumber: claim.billNumberDisplay });
      }
    }
    return { year, campaign: { id: campaign.id, fromDate: campaign.fromDate, toDate: campaign.toDate, timezone: 'Asia/Kolkata', ended: true }, prizes: [...this.configuration], candidates: [...candidates.values()] };
  }

  private select(candidates: MegaCandidate[], prizes: MegaPrize[]): Array<{ prize: MegaPrize; candidate: MegaCandidate }> {
    const pool = [...candidates];
    return prizes.map((prize) => {
      const candidate = pool.splice(this.secureIndex(pool.length), 1)[0];
      if (!candidate) throw new Error('Candidate pool unexpectedly empty.');
      return { prize, candidate };
    });
  }

  private finalize(preflight: Pick<StoredPreflight, 'reference' | 'executionYear' | 'campaign' | 'prizes' | 'candidates'>, winners: MegaDrawResult['winners'], supersedesReference?: string): MegaDrawResult {
    return { reference: preflight.reference, executionYear: preflight.executionYear, status: 'FINALIZED', completedAt: this.now().toISOString(), campaign: preflight.campaign, prizes: [...preflight.prizes], candidates: [...preflight.candidates], winners, ...(supersedesReference ? { supersedesReference } : {}) };
  }

  private nextReference(year: number): string { return `MD-${year}-${(++this.referenceSequence).toString().padStart(6, '0')}`; }
}

const toPreflight = (preflight: StoredPreflight): MegaPreflight => ({
  reference: preflight.reference,
  executionYear: preflight.executionYear,
  expiresAt: preflight.expiresAt,
  candidateCount: preflight.candidateCount,
  prizes: preflight.prizes,
  campaign: preflight.campaign,
});
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
*/

import { campaignDateInKolkata, campaignYearInKolkata, isCampaignActive } from './campaign.js';
import type { AdminClaimItem, AdminSummaryDistributionItem } from './contracts.js';
import type { Claim, ConfiguredPrize, DrawStoreSnapshot, Prize } from './domain.js';

interface CampaignConfig {
  id: string;
  timezone: 'Asia/Kolkata';
  fromDate: string;
  toDate: string;
}

export interface CampaignView extends CampaignConfig {
  status: 'ACTIVE' | 'ENDED';
}

export interface CreateClaimInput {
  claim: Claim;
  now: Date;
  // Optional request correlation id (e.g. API Gateway requestId), used only for
  // diagnostic logging in durable stores. Never used for business logic.
  correlationId?: string;
}

export type CreateClaimResult =
  | {
      type: 'CREATED';
      claim: Claim;
    }
  | {
      type: 'EXISTS';
      claim: Claim;
    };

export interface AddPrizeInput {
  name: string;
  weight: number;
  active: boolean;
}

export interface UpdatePrizeInput {
  weight?: number;
  active?: boolean;
}

export type AdminPrizeMutationResult =
  | {
      type: 'SUCCESS';
      prize: ConfiguredPrize;
    }
  | {
      type: 'VALIDATION_ERROR';
      message: string;
      fieldErrors?: Partial<Record<'name' | 'weight' | 'active', string>>;
    }
  | {
      type: 'NOT_FOUND';
      message: string;
    };

interface DrawStoreOptions {
  initialPrizes?: Prize[];
  initialClaims?: Claim[];
  initialCampaign?: CampaignConfig;
  now?: () => Date;
}

export interface AdminClaimsQuery {
  pageSize?: number;
  pageToken?: string;
  from?: string;
  to?: string;
  prizeId?: string;
  search?: string;
}

export interface AdminClaimsQueryResult {
  items: AdminClaimItem[];
  nextPageToken: string | null;
}

export interface AdminCsvClaimItem {
  claimId: string;
  claimTimestamp: string;
  customerName: string;
  phone: string;
  billNumber: string;
  prize: string;
}

// The export is built in memory and returned in a single Lambda response, so it is bounded well
// below the API Gateway payload limit rather than being allowed to exhaust memory or time out.
export const CSV_EXPORT_MAX_ROWS = 20000;

export const CSV_EXPORT_MIN_YEAR = 2000;
export const CSV_EXPORT_MAX_YEAR = 2100;

// Exports are scoped to one calendar year, so a missing year must fail rather than silently
// widening the export to every claim ever recorded.
export const parseCsvExportYear = (raw: string | null | undefined): number | null => {
  const value = (raw ?? '').trim();
  if (!/^\d{4}$/.test(value)) {
    return null;
  }

  const year = Number(value);
  if (year < CSV_EXPORT_MIN_YEAR || year > CSV_EXPORT_MAX_YEAR) {
    return null;
  }

  return year;
};

export class CsvExportTooLargeError extends Error {
  public readonly limit: number;

  public constructor(limit: number) {
    super(`Claim export exceeds the maximum of ${limit} rows.`);
    this.name = 'CsvExportTooLargeError';
    this.limit = limit;
  }
}

export interface CampaignUpdateInput {
  fromDate?: string;
  toDate?: string;
}

export type CampaignUpdateResult =
  | {
      type: 'SUCCESS';
      campaign: CampaignConfig;
    }
  | {
      type: 'VALIDATION_ERROR';
      message: string;
      fieldErrors: Partial<Record<'fromDate' | 'toDate', string>>;
    };

export interface AdminSummaryData {
  totalSuccessfulSpins: number;
  today: {
    date: string;
    successfulSpins: number;
  };
  prizeDistribution: AdminSummaryDistributionItem[];
  availableExportYears: number[];
}

const MAX_PRIZE_NAME_LENGTH = 100;

export class InMemoryDrawStore {
  private readonly claimByNormalizedBill = new Map<string, Claim>();
  private readonly claimById = new Map<string, Claim>();
  private readonly claimsInCreatedOrder: Claim[] = [];
  private totalSuccessfulSpins = 0;
  private readonly successfulByDate = new Map<string, number>();
  private readonly successfulByPrizeId = new Map<
    string,
    { prizeName: string; successfulSpins: number }
  >();
  private readonly prizeById = new Map<string, ConfiguredPrize>();
  private prizeSequence = 0;
  private campaign: CampaignConfig;
  private readonly nowProvider: () => Date;

  public constructor(options?: DrawStoreOptions) {
    this.nowProvider = options?.now ?? (() => new Date());

    const nowIso = this.nowProvider().toISOString();
    this.campaign = options?.initialCampaign ?? {
      id: 'festive-2026',
      timezone: 'Asia/Kolkata',
      fromDate: '2026-08-01',
      toDate: '2026-11-01',
    };
    const seedPrizes = options?.initialPrizes ?? [
      {
        id: 'prize-001',
        name: 'Electric Kettle',
        displayName: 'Electric Kettle',
        weight: 1,
        active: true,
      },
      {
        id: 'prize-002',
        name: 'Coffee Maker',
        displayName: 'Coffee Maker',
        weight: 3,
        active: true,
      },
      {
        id: 'prize-003',
        name: 'Mixer Grinder',
        displayName: 'Mixer Grinder',
        weight: 6,
        active: true,
      },
    ];

    for (const prize of seedPrizes) {
      const configured: ConfiguredPrize = {
        ...prize,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.prizeById.set(prize.id, configured);
      this.prizeSequence = Math.max(this.prizeSequence, parseNumericPrizeSuffix(prize.id));
    }

    for (const claim of options?.initialClaims ?? []) {
      this.storeClaim(claim);
      this.incrementAggregatesForClaim(claim, new Date(claim.claimTimestamp));
    }
  }

  public createClaimAndUpdateAggregatesAtomic(input: CreateClaimInput): CreateClaimResult {
    const existing = this.claimByNormalizedBill.get(input.claim.billNumberNormalized);
    if (existing) {
      return {
        type: 'EXISTS',
        claim: existing,
      };
    }

    this.claimByNormalizedBill.set(input.claim.billNumberNormalized, input.claim);
    this.storeClaim(input.claim);
    this.incrementAggregatesForClaim(input.claim, input.now);

    return {
      type: 'CREATED',
      claim: input.claim,
    };
  }

  public listEligiblePrizesForDraw(): Prize[] {
    return this.listAllPrizes().filter((prize) => prize.active && prize.weight > 0);
  }

  public listAllPrizes(): ConfiguredPrize[] {
    return Array.from(this.prizeById.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  public addPrize(input: AddPrizeInput): AdminPrizeMutationResult {
    const validationError = validatePrizeInput(input);
    if (validationError) {
      return validationError;
    }

    this.prizeSequence += 1;
    const id = `prize-${this.prizeSequence.toString().padStart(3, '0')}`;
    const timestamp = this.nowProvider().toISOString();

    const created: ConfiguredPrize = {
      id,
      name: input.name.trim(),
      displayName: input.name.trim(),
      weight: input.weight,
      active: input.active,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.prizeById.set(created.id, created);

    return {
      type: 'SUCCESS',
      prize: created,
    };
  }

  public updatePrize(prizeId: string, input: UpdatePrizeInput): AdminPrizeMutationResult {
    const existing = this.prizeById.get(prizeId);
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

    const updated: ConfiguredPrize = {
      ...existing,
      weight: nextWeight,
      active: nextActive,
      updatedAt: this.nowProvider().toISOString(),
    };

    this.prizeById.set(prizeId, updated);

    return {
      type: 'SUCCESS',
      prize: updated,
    };
  }

  public getClaimById(claimId: string): Claim | undefined {
    return this.claimById.get(claimId);
  }

  public listAdminClaims(query: AdminClaimsQuery): AdminClaimsQueryResult {
    const pageSize = clampPageSize(query.pageSize);
    const startIndex = decodePageToken(query.pageToken);
    const search = (query.search ?? '').trim();
    const normalizedSearch = search.toUpperCase();
    const fromMillis = parseIsoTimestamp(query.from);
    const toMillis = parseIsoTimestamp(query.to);

    const filtered = [...this.claimsInCreatedOrder].reverse().filter((claim) => {
      const claimMillis = new Date(claim.claimTimestamp).getTime();
      if (fromMillis !== null && claimMillis < fromMillis) {
        return false;
      }

      if (toMillis !== null && claimMillis > toMillis) {
        return false;
      }

      if (query.prizeId && claim.prize.id !== query.prizeId) {
        return false;
      }

      if (!search) {
        return true;
      }

      const customerName = claim.customerName.trim().toLowerCase();
      const prizeName = claim.prize.name.trim().toLowerCase();
      const searchLower = search.toLowerCase();

      return (
        claim.claimId.toLowerCase().includes(searchLower) ||
        customerName.includes(searchLower) ||
        claim.billNumberNormalized.includes(normalizedSearch) ||
        prizeName.includes(searchLower)
      );
    });

    const items = filtered.slice(startIndex, startIndex + pageSize).map((claim): AdminClaimItem => {
      return {
        claimId: claim.claimId,
        claimTimestamp: claim.claimTimestamp,
        customerName: claim.customerName,
        maskedPhone: maskPhone(claim.phone),
        billNumber: claim.billNumberDisplay,
        prize: claim.prize.name,
      };
    });

    const nextIndex = startIndex + items.length;
    const nextPageToken = nextIndex < filtered.length ? encodePageToken(nextIndex) : null;

    return {
      items,
      nextPageToken,
    };
  }

  public listAdminClaimsForCsv(year: number): AdminCsvClaimItem[] {
    const claimsForYear = this.claimsInCreatedOrder.filter(
      (claim) => campaignYearInKolkata(new Date(claim.claimTimestamp)) === year,
    );

    if (claimsForYear.length > CSV_EXPORT_MAX_ROWS) {
      throw new CsvExportTooLargeError(CSV_EXPORT_MAX_ROWS);
    }

    return [...claimsForYear].reverse().map((claim): AdminCsvClaimItem => {
      return {
        claimId: claim.claimId,
        claimTimestamp: claim.claimTimestamp,
        customerName: claim.customerName,
        phone: claim.phone,
        billNumber: claim.billNumberDisplay,
        prize: claim.prize.name,
      };
    });
  }

  public summary(): AdminSummaryData {
    const todayDate = campaignDateInKolkata(this.nowProvider());
    const todayCount = this.successfulByDate.get(todayDate) ?? 0;
    const distribution = Array.from(this.successfulByPrizeId.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([prizeId, value]): AdminSummaryDistributionItem => {
        return {
          prizeId,
          prizeName: value.prizeName,
          givenCount: value.successfulSpins,
        };
      });

    return {
      totalSuccessfulSpins: this.totalSuccessfulSpins,
      today: {
        date: todayDate,
        successfulSpins: todayCount,
      },
      prizeDistribution: distribution,
      availableExportYears: this.availableExportYears(),
    };
  }

  // Years are derived from the daily aggregate keys rather than the claims themselves so the
  // admin is only ever offered a year that would produce a non-empty export.
  private availableExportYears(): number[] {
    const years = new Set<number>();
    for (const [date, count] of this.successfulByDate.entries()) {
      if (count > 0) {
        years.add(Number(date.slice(0, 4)));
      }
    }

    return [...years].sort((left, right) => right - left);
  }

  public getCampaign(): CampaignView {
    const now = this.nowProvider();
    const status = isCampaignActive(this.campaign, now) ? 'ACTIVE' : 'ENDED';

    return {
      ...this.campaign,
      status,
    };
  }

  public updateCampaign(input: CampaignUpdateInput): CampaignUpdateResult {
    const fromDate = input.fromDate ?? this.campaign.fromDate;
    const toDate = input.toDate ?? this.campaign.toDate;
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

    this.campaign = {
      ...this.campaign,
      fromDate,
      toDate,
    };

    return {
      type: 'SUCCESS',
      campaign: this.campaign,
    };
  }

  public deleteClaim(claimId: string): { type: 'SUCCESS' } | { type: 'NOT_FOUND' } {
    const claim = this.claimById.get(claimId);
    if (!claim) {
      return { type: 'NOT_FOUND' };
    }

    this.claimById.delete(claimId);
    this.claimByNormalizedBill.delete(claim.billNumberNormalized);
    const index = this.claimsInCreatedOrder.findIndex((existing) => existing.claimId === claimId);
    if (index !== -1) {
      this.claimsInCreatedOrder.splice(index, 1);
    }
    this.decrementAggregatesForClaim(claim);

    return { type: 'SUCCESS' };
  }

  public clearAllClaims(): number {
    const deletedCount = this.claimById.size;
    this.claimById.clear();
    this.claimByNormalizedBill.clear();
    this.claimsInCreatedOrder.length = 0;
    this.totalSuccessfulSpins = 0;
    this.successfulByDate.clear();
    this.successfulByPrizeId.clear();

    return deletedCount;
  }

  public snapshot(): DrawStoreSnapshot {
    const byDate: Record<string, number> = {};
    for (const [date, count] of this.successfulByDate.entries()) {
      byDate[date] = count;
    }

    const byPrizeId: DrawStoreSnapshot['aggregate']['byPrizeId'] = {};
    for (const [prizeId, value] of this.successfulByPrizeId.entries()) {
      byPrizeId[prizeId] = {
        prizeName: value.prizeName,
        successfulSpins: value.successfulSpins,
      };
    }

    return {
      claimCount: this.claimById.size,
      aggregate: {
        totalSuccessfulSpins: this.totalSuccessfulSpins,
        byDate,
        byPrizeId,
      },
    };
  }

  private storeClaim(claim: Claim): void {
    this.claimById.set(claim.claimId, claim);
    this.claimsInCreatedOrder.push(claim);
  }

  private decrementAggregatesForClaim(claim: Claim): void {
    this.totalSuccessfulSpins = Math.max(0, this.totalSuccessfulSpins - 1);

    const campaignDate = campaignDateInKolkata(new Date(claim.claimTimestamp));
    const previousDateCount = this.successfulByDate.get(campaignDate) ?? 0;
    if (previousDateCount <= 1) {
      this.successfulByDate.delete(campaignDate);
    } else {
      this.successfulByDate.set(campaignDate, previousDateCount - 1);
    }

    const existingPrizeAggregate = this.successfulByPrizeId.get(claim.prize.id);
    if (existingPrizeAggregate) {
      if (existingPrizeAggregate.successfulSpins <= 1) {
        this.successfulByPrizeId.delete(claim.prize.id);
      } else {
        this.successfulByPrizeId.set(claim.prize.id, {
          ...existingPrizeAggregate,
          successfulSpins: existingPrizeAggregate.successfulSpins - 1,
        });
      }
    }
  }

  private incrementAggregatesForClaim(claim: Claim, when: Date): void {
    this.totalSuccessfulSpins += 1;

    const campaignDate = campaignDateInKolkata(when);
    const previousDateCount = this.successfulByDate.get(campaignDate) ?? 0;
    this.successfulByDate.set(campaignDate, previousDateCount + 1);

    const existingPrizeAggregate = this.successfulByPrizeId.get(claim.prize.id);
    if (existingPrizeAggregate) {
      this.successfulByPrizeId.set(claim.prize.id, {
        ...existingPrizeAggregate,
        successfulSpins: existingPrizeAggregate.successfulSpins + 1,
      });
    } else {
      this.successfulByPrizeId.set(claim.prize.id, {
        prizeName: claim.prize.name,
        successfulSpins: 1,
      });
    }
  }
}

const clampPageSize = (value: number | undefined): number => {
  if (value === undefined) {
    return 25;
  }

  if (!Number.isInteger(value) || value < 1 || value > 150) {
    return 25;
  }

  return value;
};

const encodePageToken = (index: number): string => {
  return Buffer.from(`offset:${index}`, 'utf-8').toString('base64url');
};

const decodePageToken = (token: string | undefined): number => {
  if (!token) {
    return 0;
  }

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    if (!decoded.startsWith('offset:')) {
      return 0;
    }

    const value = Number(decoded.slice('offset:'.length));
    if (!Number.isInteger(value) || value < 0) {
      return 0;
    }

    return value;
  } catch {
    return 0;
  }
};

const parseIsoTimestamp = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
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

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  const tail = digits.slice(-4);
  return `*****${tail.padStart(4, '*')}`;
};

const validatePrizeInput = (
  input: AddPrizeInput,
): Extract<AdminPrizeMutationResult, { type: 'VALIDATION_ERROR' }> | null => {
  const fieldErrors: Partial<Record<'name' | 'weight' | 'active', string>> = {};

  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    fieldErrors.name = 'Prize name is required.';
  } else if (trimmedName.length > MAX_PRIZE_NAME_LENGTH) {
    fieldErrors.name = 'Prize name must be at most 100 characters.';
  }

  if (!Number.isFinite(input.weight) || input.weight <= 0) {
    fieldErrors.weight = 'Weight must be a positive number.';
  }

  if (typeof input.active !== 'boolean') {
    fieldErrors.active = 'Active must be true or false.';
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

const parseNumericPrizeSuffix = (prizeId: string): number => {
  const numeric = Number(prizeId.replace(/[^0-9]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
};

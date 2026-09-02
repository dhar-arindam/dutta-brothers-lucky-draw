import type { Campaign } from './domain.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

type CampaignWindow = Campaign | { fromDate?: string; toDate?: string };

const parseStrictDate = (dateText: string): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
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

  return { year, month, day };
};

const toKolkataBoundaryUtcMs = (dateText: string, boundary: 'start' | 'end'): number | null => {
  const parsed = parseStrictDate(dateText);
  if (!parsed) {
    return null;
  }

  const hour = boundary === 'start' ? 0 : 23;
  const minute = boundary === 'start' ? 0 : 59;
  const second = boundary === 'start' ? 0 : 59;
  const millisecond = boundary === 'start' ? 0 : 999;

  const utcAsIfLocal = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    hour,
    minute,
    second,
    millisecond,
  );

  return utcAsIfLocal - IST_OFFSET_MS;
};

export const isCampaignActive = (campaign: CampaignWindow, now: Date): boolean => {
  if ('startAt' in campaign && 'endAt' in campaign) {
    const start = new Date(campaign.startAt);
    const end = new Date(campaign.endAt);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return false;
    }

    return now >= start && now <= end;
  }

  const fromDate = campaign.fromDate;
  const toDate = campaign.toDate;
  if (!fromDate || !toDate) {
    return false;
  }

  const startMs = toKolkataBoundaryUtcMs(fromDate, 'start');
  const endMs = toKolkataBoundaryUtcMs(toDate, 'end');
  if (startMs === null || endMs === null || startMs > endMs) {
    return false;
  }

  const nowMs = now.getTime();
  return nowMs >= startMs && nowMs <= endMs;
};

export const campaignDateInKolkata = (now: Date): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
};

export const campaignYearInKolkata = (instant: Date): number => {
  return Number(campaignDateInKolkata(instant).slice(0, 4));
};

import { describe, expect, it } from 'vitest';

import { campaignDateInKolkata, isCampaignActive } from './campaign.js';

describe('campaign window evaluation', () => {
  it('returns false when campaign dates are missing', () => {
    expect(isCampaignActive({}, new Date('2026-08-16T10:00:00.000Z'))).toBe(false);
  });

  it('supports before/start/active/end/after checks for calendar-date campaign', () => {
    const campaign = {
      fromDate: '2026-08-16',
      toDate: '2026-08-20',
    };

    expect(isCampaignActive(campaign, new Date('2026-08-15T18:29:59.999Z'))).toBe(false);
    expect(isCampaignActive(campaign, new Date('2026-08-15T18:30:00.000Z'))).toBe(true);
    expect(isCampaignActive(campaign, new Date('2026-08-18T12:00:00.000Z'))).toBe(true);
    expect(isCampaignActive(campaign, new Date('2026-08-20T18:29:59.999Z'))).toBe(true);
    expect(isCampaignActive(campaign, new Date('2026-08-20T18:30:00.000Z'))).toBe(false);
  });

  it('uses startAt/endAt contract when provided', () => {
    const campaign = {
      id: 'festive-2026',
      timezone: 'Asia/Kolkata' as const,
      startAt: '2026-08-01T00:00:00.000Z',
      endAt: '2026-08-01T23:59:59.999Z',
    };

    expect(isCampaignActive(campaign, new Date('2026-07-31T23:59:59.999Z'))).toBe(false);
    expect(isCampaignActive(campaign, new Date('2026-08-01T00:00:00.000Z'))).toBe(true);
    expect(isCampaignActive(campaign, new Date('2026-08-01T23:59:59.999Z'))).toBe(true);
    expect(isCampaignActive(campaign, new Date('2026-08-02T00:00:00.000Z'))).toBe(false);
  });

  it('returns false for invalid campaign configuration', () => {
    expect(
      isCampaignActive(
        {
          fromDate: '2026-02-31',
          toDate: '2026-08-16',
        },
        new Date('2026-08-16T10:00:00.000Z'),
      ),
    ).toBe(false);

    expect(
      isCampaignActive(
        {
          fromDate: '2026-09-01',
          toDate: '2026-08-01',
        },
        new Date('2026-08-16T10:00:00.000Z'),
      ),
    ).toBe(false);

    expect(
      isCampaignActive(
        {
          id: 'festive-2026',
          timezone: 'Asia/Kolkata' as const,
          startAt: 'invalid',
          endAt: '2026-08-16T10:00:00.000Z',
        },
        new Date('2026-08-16T10:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('campaign date formatting', () => {
  it('formats date in Asia/Kolkata timezone', () => {
    expect(campaignDateInKolkata(new Date('2026-08-15T20:00:00.000Z'))).toBe('2026-08-16');
  });
});

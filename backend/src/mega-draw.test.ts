import { describe, expect, it } from 'vitest';

import type { Claim } from './domain.js';
import { MegaDrawError, MegaDrawService } from './mega-draw.js';
import type { CampaignView } from './store.js';

const now = new Date('2026-11-02T00:00:00.000Z');

const claim = (claimId: string, bill: string, phone: string): Claim => ({
  claimId,
  claimTimestamp: '2026-10-30T10:00:00.000Z',
  customerName: `Customer ${claimId}`,
  phone,
  billNumberDisplay: bill,
  billNumberNormalized: bill,
  prize: { id: 'main-1', name: 'Main Prize', displayName: 'Main Prize' },
});

const campaign: CampaignView = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  fromDate: '2026-08-01',
  toDate: '2026-11-01',
  status: 'ENDED',
};

describe('MegaDrawService', () => {
  it('deduplicates bill and phone identities, selects without replacement, and recovers a retry', () => {
    const service = new MegaDrawService(
      {
        getCampaign: () => campaign,
        listActiveClaims: () => [
          claim('DB26-1', 'BILL-1', '9876543210'),
          claim('DB26-2', 'BILL-1', '9876543210'),
          claim('DB26-3', 'BILL-2', '9876543210'),
          claim('DB26-4', 'BILL-3', '9123456789'),
        ],
      },
      () => now,
      () => 0,
    );
    service.configure(['First', 'Second']);
    const preflight = service.preflight();

    expect(preflight.candidateCount).toBe(3);
    const result = service.drawNext({
      preflightReference: preflight.reference,
      idempotencyKey: 'attempt-1',
      operatorSubject: 'admin-1',
      acknowledgement: true,
      confirmation: 'DRAW NEXT MEGA PRIZE 2026',
    });
    const retry = service.drawNext({
      preflightReference: preflight.reference,
      idempotencyKey: 'attempt-1',
      operatorSubject: 'admin-1',
      acknowledgement: true,
      confirmation: 'DRAW NEXT MEGA PRIZE 2026',
    });

    expect(result.lifecycle.status).toBe('IN_PROGRESS');
    expect(result.selectedRow.prize.position).toBe(1);
    expect(retry).toEqual(result);
  });

  it('rejects a preflight when the candidate population changes', () => {
    const claims = [claim('DB26-1', 'BILL-1', '9876543210')];
    const service = new MegaDrawService(
      { getCampaign: () => campaign, listActiveClaims: () => claims },
      () => now,
    );
    service.configure(['First']);
    const preflight = service.preflight();
    claims.push(claim('DB26-2', 'BILL-2', '9123456789'));

    expect(() =>
      service.drawNext({
        preflightReference: preflight.reference,
        idempotencyKey: 'attempt-1',
        operatorSubject: 'admin-1',
        acknowledgement: true,
        confirmation: 'DRAW NEXT MEGA PRIZE 2026',
      }),
    ).toThrow(MegaDrawError);
    try {
      service.drawNext({
        preflightReference: preflight.reference,
        idempotencyKey: 'attempt-1',
        operatorSubject: 'admin-1',
        acknowledgement: true,
        confirmation: 'DRAW NEXT MEGA PRIZE 2026',
      });
    } catch (error) {
      expect((error as MegaDrawError).code).toBe('PREFLIGHT_STALE');
    }
  });

  it('resets to an isolated empty editable epoch without changing main-draw source data', () => {
    const activeClaims = [
      claim('DB26-1', 'BILL-1', '9876543210'),
      claim('DB26-2', 'BILL-2', '9123456789'),
      claim('DB26-3', 'BILL-3', '9988776655'),
      claim('DB26-4', 'BILL-4', '9876501234'),
    ];
    const service = new MegaDrawService(
      {
        getCampaign: () => campaign,
        listActiveClaims: () => activeClaims,
      },
      () => now,
      () => 0,
    );
    service.configure(['First', 'Second']);
    const preflight = service.preflight();
    const original = service.drawNext({
      preflightReference: preflight.reference,
      idempotencyKey: 'run',
      operatorSubject: 'admin',
      acknowledgement: true,
      confirmation: 'DRAW NEXT MEGA PRIZE 2026',
    }).lifecycle;
    expect(service.reset({ acknowledgement: true, confirmation: 'RESET MEGA DRAW 2026' })).toEqual({
      executionYear: 2026,
    });

    expect(service.get()).toEqual({ configuration: [] });
    expect(activeClaims).toHaveLength(4);
    expect(() =>
      service.drawNext({
        idempotencyKey: 'run',
        operatorSubject: 'admin',
        acknowledgement: true,
        confirmation: 'DRAW NEXT MEGA PRIZE 2026',
      }),
    ).toThrow(MegaDrawError);
    expect(original.selectedRows).toHaveLength(1);
  });
});

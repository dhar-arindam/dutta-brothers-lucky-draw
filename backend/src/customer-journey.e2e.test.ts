import { describe, expect, it } from 'vitest';

import { ClaimIdGenerator } from './claim-id.js';
import type { DrawRequest } from './contracts.js';
import type { Campaign, Prize } from './domain.js';
import { DrawService } from './draw-service.js';
import { InMemoryDrawStore } from './store.js';

const now = new Date('2026-08-16T10:30:00.000Z');

const activeCampaign: Campaign = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-11-01T18:29:59.000Z',
};

const createService = (options?: {
  prizes?: Prize[];
  campaign?: Campaign;
  random?: () => number;
}) => {
  const store = new InMemoryDrawStore({
    initialPrizes: options?.prizes ?? [
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
    ],
    now: () => now,
  });

  const service = new DrawService({
    campaign: options?.campaign ?? activeCampaign,
    claimIdGenerator: new ClaimIdGenerator(),
    store,
    random: options?.random ?? (() => 0.95),
    now: () => now,
  });

  return { service, store };
};

const requestForBill = (
  billNumber: string,
  name = 'Arindam Roy',
  phone = '9876543210',
): DrawRequest => {
  return {
    name,
    phone,
    billNumber,
  };
};

describe('customer journey e2e backend', () => {
  it('E2E-03 Duplicate Bill', () => {
    const { service, store } = createService();

    const first = service.execute(requestForBill('DB-E2E-03'));
    const duplicate = service.execute(requestForBill(' db-e2e-03 '));

    expect(first.statusCode).toBe(201);
    expect(first.body.status).toBe('SUCCESS');

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body.status).toBe('ALREADY_CLAIMED');

    expect(store.snapshot().claimCount).toBe(1);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);
  });

  it('E2E-04 Same Bill Different Customer', () => {
    const { service, store } = createService();

    const first = service.execute(requestForBill('DB-E2E-04', 'Customer A', '9123456789'));
    const second = service.execute(requestForBill('DB-E2E-04', 'Customer B', '9234567890'));

    expect(first.body.status).toBe('SUCCESS');
    expect(second.body.status).toBe('ALREADY_CLAIMED');
    expect(store.snapshot().claimCount).toBe(1);
  });

  it('E2E-05 Concurrent Duplicate', async () => {
    const { service, store } = createService();

    const tasks = Array.from({ length: 12 }, (_, index) => {
      return Promise.resolve(
        service.execute(
          requestForBill(
            'DB-E2E-05',
            'Concurrent Customer',
            `90000000${String(index).padStart(2, '0')}`,
          ),
        ),
      );
    });

    const results = await Promise.all(tasks);
    const successCount = results.filter((result) => result.body.status === 'SUCCESS').length;
    const alreadyClaimedCount = results.filter(
      (result) => result.body.status === 'ALREADY_CLAIMED',
    ).length;

    expect(successCount).toBe(1);
    expect(alreadyClaimedCount).toBe(11);
    expect(store.snapshot().claimCount).toBe(1);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);
  });

  it('E2E-06 Draw Ended', () => {
    const { service, store } = createService({
      campaign: {
        ...activeCampaign,
        endAt: '2026-08-16T09:30:00.000Z',
      },
    });

    const response = service.execute(requestForBill('DB-E2E-06'));

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'DRAW_ENDED',
    });
    expect(store.snapshot().claimCount).toBe(0);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(0);
  });

  it('E2E-07 No Eligible Prize', () => {
    const { service, store } = createService({
      prizes: [
        {
          id: 'prize-010',
          name: 'Inactive Prize',
          displayName: 'Inactive Prize',
          weight: 1,
          active: false,
        },
      ],
    });

    const response = service.execute(requestForBill('DB-E2E-07'));

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'NO_ELIGIBLE_PRIZE',
    });
    expect(store.snapshot().claimCount).toBe(0);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(0);
  });

  it('E2E-09 Lost Response and Retry', () => {
    const { service, store } = createService();

    const first = service.execute(requestForBill('DB-E2E-09'));
    const retry = service.execute(requestForBill('DB-E2E-09'));

    expect(first.body.status).toBe('SUCCESS');
    expect(retry.body.status).toBe('ALREADY_CLAIMED');

    if (first.body.status === 'SUCCESS' && retry.body.status === 'ALREADY_CLAIMED') {
      expect(retry.body.claimId).toBe(first.body.claimId);
      expect(retry.body.prize.id).toBe(first.body.prize.id);
    }

    expect(store.snapshot().claimCount).toBe(1);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(1);
  });

  it('E2E-10 Repeated Successful Draws', () => {
    const { service, store } = createService();

    const a = service.execute(requestForBill('DB-E2E-10-A'));
    const b = service.execute(requestForBill('DB-E2E-10-B'));
    const c = service.execute(requestForBill('DB-E2E-10-C'));

    expect(a.body.status).toBe('SUCCESS');
    expect(b.body.status).toBe('SUCCESS');
    expect(c.body.status).toBe('SUCCESS');

    if (a.body.status === 'SUCCESS') {
      expect(a.body.claimId).toMatch(/^DB26-\d{6}$/);
      expect(a.body.wheel.sectorPrizeIds.length).toBeGreaterThan(0);
    }

    if (b.body.status === 'SUCCESS') {
      expect(b.body.claimId).toMatch(/^DB26-\d{6}$/);
      expect(b.body.wheel.sectorPrizeIds.length).toBeGreaterThan(0);
    }

    if (c.body.status === 'SUCCESS') {
      expect(c.body.claimId).toMatch(/^DB26-\d{6}$/);
      expect(c.body.wheel.sectorPrizeIds.length).toBeGreaterThan(0);
    }

    expect(store.snapshot().claimCount).toBe(3);
    expect(store.snapshot().aggregate.totalSuccessfulSpins).toBe(3);
  });
});

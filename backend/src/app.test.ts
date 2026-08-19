import { describe, expect, it } from 'vitest';

import { ClaimIdGenerator } from './claim-id.js';
import { createDrawApiHandler } from './app.js';
import type { Campaign } from './domain.js';
import { DrawService } from './draw-service.js';
import { InMemoryDrawStore } from './store.js';

const now = new Date('2026-08-16T10:30:00.000Z');

const campaign: Campaign = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-11-01T18:29:59.000Z',
};

const createHandler = () => {
  const store = new InMemoryDrawStore({
    initialPrizes: [
      {
        id: 'prize-1',
        name: 'Electric Kettle',
        displayName: 'Electric Kettle',
        weight: 1,
        active: true,
      },
    ],
    now: () => now,
  });

  const service = new DrawService({
    campaign,
    claimIdGenerator: new ClaimIdGenerator(),
    store,
    random: () => 0,
    now: () => now,
  });

  return createDrawApiHandler(service);
};

describe('draw api contract', () => {
  it('returns validation error for invalid json', () => {
    const handler = createHandler();

    const response = handler.handle('{not-json');

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      message: 'Please check the form and try again.',
    });
  });

  it('returns validation error for schema mismatch', () => {
    const handler = createHandler();

    const response = handler.handle(
      JSON.stringify({
        name: 'Arindam',
        phone: '9876543210',
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns success schema and status code', () => {
    const handler = createHandler();

    const response = handler.handle(
      JSON.stringify({
        name: 'Arindam',
        phone: '9876543210',
        billNumber: 'DB12345',
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      status: 'SUCCESS',
      claimId: expect.stringMatching(/^DB26-\d{6}$/),
      claimTimestamp: '2026-08-16T10:30:00.000Z',
      prize: {
        id: 'prize-1',
        name: 'Electric Kettle',
        displayName: 'Electric Kettle',
      },
      wheel: {
        sectorPrizeIds: ['prize-1'],
      },
    });
  });

  it('returns already claimed for retry with original claim information', () => {
    const handler = createHandler();
    const payload = JSON.stringify({
      name: 'Arindam',
      phone: '9876543210',
      billNumber: 'DB12345',
    });

    const first = handler.handle(payload);
    const retry = handler.handle(payload);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatchObject({
      status: 'ALREADY_CLAIMED',
      claimId: expect.stringMatching(/^DB26-\d{6}$/),
      claimTimestamp: '2026-08-16T10:30:00.000Z',
      prize: {
        id: 'prize-1',
      },
    });
  });
});

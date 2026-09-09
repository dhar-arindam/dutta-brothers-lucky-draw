import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';

import { DurableMegaDrawService } from './durable-mega-draw.js';
import type { MegaDrawLifecycle } from './mega-draw.js';

const now = new Date('2026-11-02T00:00:00.000Z');
const original: MegaDrawLifecycle = {
  reference: 'MD-2026-original',
  executionYear: 2026,
  cycleNumber: 1,
  status: 'COMPLETED',
  completedAt: now.toISOString(),
  campaign: {
    id: 'festive-2026',
    fromDate: '2026-08-01',
    toDate: '2026-11-01',
    timezone: 'Asia/Kolkata',
    ended: true,
  },
  prizes: [{ position: 1, name: 'First' }],
  candidates: [],
  selectedRows: [],
  nextPrizeOrdinal: 0,
  remainingPrizes: [],
};
const current: MegaDrawLifecycle = { ...original, reference: 'MD-2026-current' };

class FakeDocClient {
  public async send(command: unknown): Promise<unknown> {
    if (command instanceof GetCommand) {
      const sk = command.input.Key?.sk;
      if (sk === 'CURRENT') return { Item: { value: { epoch: 'current' } } };
      if (sk === 'CONFIG') return { Item: { value: [{ position: 1, name: 'First' }] } };
      if (sk === 'EPOCH#current#STATE') return { Item: { value: current } };
      if (sk === 'EPOCH#current#IDEMP#admin-1#lost-response')
        return { Item: { value: { operation: 'DRAW_NEXT', lifecycle: current } } };
      return {};
    }
    if (command instanceof QueryCommand) {
      return { Items: [] };
    }
    throw new Error('Unexpected DynamoDB command.');
  }
}

describe('DurableMegaDrawService reads', () => {
  it('reads only current-epoch state and subject-scoped draw-next recovery', async () => {
    const service = new DurableMegaDrawService(
      new FakeDocClient(),
      'draws-table',
      {} as never,
      () => now,
    );

    await expect(service.get()).resolves.toEqual({
      configuration: [{ position: 1, name: 'First' }],
      lifecycle: current,
      history: [],
    });
    await expect(service.status('lost-response', 'admin-1')).resolves.toEqual({
      execution: 'COMPLETED',
      operation: 'DRAW_NEXT',
      lifecycle: current,
    });
    await expect(service.status('lost-response', 'admin-2')).resolves.toEqual({
      execution: 'NOT_FOUND',
    });
  });
});

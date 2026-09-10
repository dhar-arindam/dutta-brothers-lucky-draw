import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { expect, it } from 'vitest';

import { DurableMegaDrawService } from './durable-mega-draw.js';

const now = new Date('2026-11-02T00:00:00.000Z');
const campaign = {
  id: 'festive-2026',
  fromDate: '2026-08-01',
  toDate: '2026-11-01',
  status: 'ENDED' as const,
};
const claims = ['A', 'B', 'C', 'D'].map((billNumberNormalized, index) => ({
  claimId: `claim-${index + 1}`,
  claimTimestamp: '2026-10-20T00:00:00.000Z',
  customerName: `Customer ${index + 1}`,
  phone: `91234567${index}`.padEnd(10, '0'),
  billNumberNormalized,
  billNumberDisplay: billNumberNormalized,
}));

class MemoryDocClient {
  public readonly items = new Map<string, Record<string, unknown>>();
  public transactionCount = 0;
  public rejectNextTransaction = false;
  public async send(command: unknown): Promise<unknown> {
    if (command instanceof GetCommand) {
      const item = command.input.Key as { pk: string; sk: string };
      return { Item: this.items.get(`${item.pk}|${item.sk}`) };
    }
    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues as {
        ':pk': string;
        ':prefix'?: string;
      };
      return {
        Items: [...this.items.values()].filter(
          (item) =>
            item.pk === values[':pk'] &&
            (!values[':prefix'] || (item.sk as string).startsWith(values[':prefix'])),
        ),
      };
    }
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      this.items.set(`${item.pk}|${item.sk}`, item);
      return {};
    }
    if (command instanceof TransactWriteCommand) {
      if (this.rejectNextTransaction) {
        this.rejectNextTransaction = false;
        throw new Error('ConditionalCheckFailed');
      }
      const writes = command.input.TransactItems ?? [];
      for (const write of writes) this.assertCondition(write as Record<string, unknown>);
      for (const write of writes) this.apply(write as Record<string, unknown>);
      this.transactionCount += 1;
      return {};
    }
    throw new Error('Unexpected DynamoDB command.');
  }
  private assertCondition(write: Record<string, unknown>): void {
    if ('ConditionCheck' in write || 'Delete' in write) return;
    if ('Put' in write) {
      const put = write.Put as { Item: Record<string, unknown>; ConditionExpression?: string };
      if (put.ConditionExpression && this.items.has(`${put.Item.pk}|${put.Item.sk}`))
        throw new Error('ConditionalCheckFailed');
      return;
    }
    const update = write.Update as {
      Key: { pk: string; sk: string };
      ConditionExpression?: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    const current = this.items.get(`${update.Key.pk}|${update.Key.sk}`)?.value as
      { reference?: string; nextPrizeOrdinal?: number } | undefined;
    if (!current && update.ConditionExpression?.includes('attribute_not_exists(pk)')) return;
    const reference =
      update.ExpressionAttributeValues[':reference'] ??
      update.ExpressionAttributeValues[':original'];
    if (
      !current ||
      (update.ConditionExpression?.includes('#reference') && current.reference !== reference) ||
      (update.ConditionExpression?.includes('#ordinal') &&
        current.nextPrizeOrdinal !== update.ExpressionAttributeValues[':ordinal'])
    )
      throw new Error('ConditionalCheckFailed');
  }
  private apply(write: Record<string, unknown>): void {
    if ('Put' in write) {
      const put = write.Put as { Item: Record<string, unknown> };
      this.items.set(`${put.Item.pk}|${put.Item.sk}`, put.Item);
      return;
    }
    if ('ConditionCheck' in write) return;
    if ('Delete' in write) {
      const deleted = write.Delete as { Key: { pk: string; sk: string } };
      this.items.delete(`${deleted.Key.pk}|${deleted.Key.sk}`);
      return;
    }
    const update = write.Update as {
      Key: { pk: string; sk: string };
      ExpressionAttributeValues: Record<string, unknown>;
    };
    const identity = `${update.Key.pk}|${update.Key.sk}`;
    const existing = this.items.get(identity);
    if (existing)
      existing.value =
        update.ExpressionAttributeValues[':value'] ?? update.ExpressionAttributeValues[':next'];
    else
      this.items.set(identity, {
        pk: update.Key.pk,
        sk: update.Key.sk,
        value: update.ExpressionAttributeValues[':next'],
        entityType: update.ExpressionAttributeValues[':entityType'],
      });
  }
}

const serviceFor = (client: MemoryDocClient) =>
  new DurableMegaDrawService(
    client,
    'draws-table',
    { getCampaign: async () => campaign, listActiveClaims: async () => claims } as never,
    () => now,
    () => 0,
  );
const request = (idempotencyKey: string, preflightReference?: string) => ({
  idempotencyKey,
  operatorSubject: 'admin-1',
  acknowledgement: true,
  confirmation: 'DRAW NEXT MEGA PRIZE 2026',
  ...(preflightReference ? { preflightReference } : {}),
});

it('persists one distinct ordinal per draw-next, recovers retries, and completes only on the final prize', async () => {
  const client = new MemoryDocClient();
  const service = serviceFor(client);
  await service.configure(['First', 'Second', 'Third']);
  const preflight = await service.preflight();
  const first = await service.drawNext(request('one', preflight.reference));
  const retry = await serviceFor(client).drawNext(request('one', preflight.reference));
  const second = await serviceFor(client).drawNext(request('two'));
  const third = await serviceFor(client).drawNext(request('three'));

  expect(retry).toEqual(first);
  expect([first, second, third].map((result) => result.selectedRow.prize.position)).toEqual([
    3, 2, 1,
  ]);
  expect(new Set(third.lifecycle.selectedRows.map((row) => row.candidate.identity)).size).toBe(3);
  expect(third.lifecycle).toMatchObject({
    status: 'COMPLETED',
    nextPrizeOrdinal: 0,
    remainingPrizes: [],
  });
  expect(client.transactionCount).toBe(3);
});

it('rejects a stale concurrent ordinal transaction without persisting a second winner', async () => {
  const client = new MemoryDocClient();
  const service = serviceFor(client);
  await service.configure(['First', 'Second', 'Third']);
  const preflight = await service.preflight();
  const first = await service.drawNext(request('one', preflight.reference));
  await service.drawNext(request('two'));
  client.rejectNextTransaction = true;

  await expect(service.drawNext(request('concurrent'))).rejects.toMatchObject({
    code: 'MEGA_DRAW_IN_PROGRESS',
  });
  expect((await serviceFor(client).get()).lifecycle?.selectedRows).toHaveLength(2);
  expect(first.selectedRow.prize.position).toBe(3);
});

it('retains editable configuration without retaining winner history or audit records after reset', async () => {
  const client = new MemoryDocClient();
  const service = serviceFor(client);
  await service.configure(['First']);
  const preflight = await service.preflight();
  const original = await service.drawNext(request('one', preflight.reference));
  await service.reset({ acknowledgement: true, confirmation: 'RESET MEGA DRAW 2026' });
  const read = await serviceFor(client).get();

  expect(read).toEqual({ configuration: [{ position: 1, name: 'First' }], history: [] });
  expect([...client.items.values()].filter((item) => item.entityType === 'MEGA_AUDIT')).toEqual([]);
  expect(original.lifecycle.selectedRows).toHaveLength(1);
});

it('closes only a completed lifecycle and blocks further mutations while retaining results', async () => {
  const client = new MemoryDocClient();
  const service = serviceFor(client);
  await service.configure(['Only prize']);
  const preflight = await service.preflight();
  await service.drawNext(request('draw', preflight.reference));

  const closed = await service.close({
    acknowledgement: true,
    confirmation: 'CLOSE MEGA DRAW 2026',
  });

  expect(closed.lifecycle).toMatchObject({
    status: 'CLOSED',
    selectedRows: [{ prize: { position: 1 } }],
  });
  await expect(service.preflight()).rejects.toMatchObject({ code: 'MEGA_DRAW_CLOSED' });
  await expect(service.configure(['Replacement prize'])).rejects.toMatchObject({
    code: 'MEGA_DRAW_CLOSED',
  });
  await expect(
    service.reset({ acknowledgement: true, confirmation: 'RESET MEGA DRAW 2026' }),
  ).rejects.toMatchObject({ code: 'MEGA_DRAW_CLOSED' });
});

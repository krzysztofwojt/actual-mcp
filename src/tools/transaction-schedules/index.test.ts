import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionScheduleWriteTools } from './index.js';

vi.mock('../../domain/transaction-schedule-api.js', () => ({
  getTransactionById: vi.fn(),
  setTransactionSchedule: vi.fn(),
}));
vi.mock('../../domain/schedule-api.js', () => ({ getSchedules: vi.fn() }));

import * as transactionScheduleApi from '../../domain/transaction-schedule-api.js';
import { getSchedules } from '../../domain/schedule-api.js';

const transactionId = '11111111-1111-4111-8111-111111111111';
const scheduleId = '22222222-2222-4222-8222-222222222222';
const otherScheduleId = '33333333-3333-4333-8333-333333333333';

function handler(name: string): (typeof transactionScheduleWriteTools)[number]['handler'] {
  return transactionScheduleWriteTools.find((tool) => tool.schema.name === name)!.handler;
}

function json(result: Awaited<ReturnType<ReturnType<typeof handler>>>): Record<string, unknown> {
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected text content');
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe('transaction schedule tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSchedules).mockResolvedValue([
      {
        id: scheduleId,
        name: 'Magda Kotwas',
        posts_transaction: false,
        amountOp: 'is',
        date: '2026-08-25',
      },
    ]);
    vi.mocked(transactionScheduleApi.getTransactionById).mockResolvedValue({
      id: transactionId,
      account: 'account-1',
      date: '2026-08-25',
      amount: -1000,
    });
  });

  it('registers symmetric match and unmatch tools', () => {
    expect(transactionScheduleWriteTools.map((tool) => tool.schema.name)).toEqual([
      'match-transaction-to-schedule',
      'unmatch-transaction-from-schedule',
    ]);
  });

  it('matches by unique case-insensitive schedule name', async () => {
    const result = await handler('match-transaction-to-schedule')({
      transaction: transactionId,
      schedule: 'magda kotwas',
    } as never);

    expect(transactionScheduleApi.setTransactionSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: transactionId }),
      scheduleId
    );
    expect(json(result)).toMatchObject({ transactionId, scheduleId, scheduleName: 'Magda Kotwas', matched: true });
  });

  it('returns idempotent success when already matched to the requested schedule', async () => {
    vi.mocked(transactionScheduleApi.getTransactionById).mockResolvedValue({
      id: transactionId,
      account: 'account-1',
      date: '2026-08-25',
      amount: -1000,
      schedule: scheduleId,
    });

    const result = await handler('match-transaction-to-schedule')({
      transaction: transactionId,
      schedule: scheduleId,
    } as never);

    expect(transactionScheduleApi.setTransactionSchedule).not.toHaveBeenCalled();
    expect(json(result)).toMatchObject({ matched: true, alreadyMatched: true });
  });

  it('rejects a transaction already linked to another schedule without writing', async () => {
    vi.mocked(transactionScheduleApi.getTransactionById).mockResolvedValue({
      id: transactionId,
      account: 'account-1',
      date: '2026-08-25',
      amount: -1000,
      schedule: otherScheduleId,
    });

    const result = await handler('match-transaction-to-schedule')({
      transaction: transactionId,
      schedule: scheduleId,
    } as never);

    expect(result.isError).toBe(true);
    expect(transactionScheduleApi.setTransactionSchedule).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous case-insensitive schedule name without writing', async () => {
    vi.mocked(getSchedules).mockResolvedValue([
      {
        id: scheduleId,
        name: 'Magda Kotwas',
        posts_transaction: false,
        amountOp: 'is',
        date: '2026-08-25',
      },
      {
        id: otherScheduleId,
        name: 'MAGDA KOTWAS',
        posts_transaction: false,
        amountOp: 'is',
        date: '2026-08-25',
      },
    ]);

    const result = await handler('match-transaction-to-schedule')({
      transaction: transactionId,
      schedule: 'magda kotwas',
    } as never);

    expect(result.isError).toBe(true);
    expect(transactionScheduleApi.setTransactionSchedule).not.toHaveBeenCalled();
  });

  it('requires an exact transaction UUID', async () => {
    const result = await handler('match-transaction-to-schedule')({
      transaction: 'not-a-uuid',
      schedule: scheduleId,
    } as never);

    expect(result.isError).toBe(true);
    expect(transactionScheduleApi.getTransactionById).not.toHaveBeenCalled();
  });

  it('unmatches a linked transaction and returns its previous schedule', async () => {
    vi.mocked(transactionScheduleApi.getTransactionById).mockResolvedValue({
      id: transactionId,
      account: 'account-1',
      date: '2026-08-25',
      amount: -1000,
      schedule: scheduleId,
    });

    const result = await handler('unmatch-transaction-from-schedule')({ transaction: transactionId } as never);

    expect(transactionScheduleApi.setTransactionSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: transactionId }),
      null
    );
    expect(json(result)).toMatchObject({ transactionId, scheduleId, scheduleName: 'Magda Kotwas', matched: false });
  });

  it('returns idempotent success when the transaction is already unmatched', async () => {
    const result = await handler('unmatch-transaction-from-schedule')({ transaction: transactionId } as never);

    expect(getSchedules).not.toHaveBeenCalled();
    expect(transactionScheduleApi.setTransactionSchedule).not.toHaveBeenCalled();
    expect(json(result)).toMatchObject({ transactionId, matched: false, alreadyUnmatched: true });
  });
});

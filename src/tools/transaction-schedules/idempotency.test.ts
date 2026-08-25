import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../actual-api.js', () => ({ syncActual: vi.fn() }));
vi.mock('../../domain/transaction-schedule-api.js', () => ({
  getTransactionById: vi.fn(),
  setTransactionSchedule: vi.fn(),
}));
vi.mock('../../domain/schedule-api.js', () => ({ getSchedules: vi.fn() }));

import { executeMutation } from '../../core/runtime/operation-runtime.js';
import * as transactionScheduleApi from '../../domain/transaction-schedule-api.js';
import { getSchedules } from '../../domain/schedule-api.js';
import { transactionScheduleWriteTools } from './index.js';

const transactionId = '11111111-1111-4111-8111-111111111111';
const scheduleId = '22222222-2222-4222-8222-222222222222';

describe('transaction schedule operationId semantics', () => {
  let stateDir: string;
  const tool = transactionScheduleWriteTools.find((item) => item.schema.name === 'match-transaction-to-schedule')!;

  beforeEach(() => {
    vi.clearAllMocks();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-schedule-operation-'));
    process.env.ACTUAL_MCP_STATE_DIR = stateDir;
    vi.mocked(transactionScheduleApi.getTransactionById).mockResolvedValue({
      id: transactionId,
      account: 'account-1',
      date: '2026-08-25',
      amount: -1000,
    });
    vi.mocked(getSchedules).mockResolvedValue([
      {
        id: scheduleId,
        name: 'Magda Kotwas',
        posts_transaction: false,
        amountOp: 'is',
        date: '2026-08-25',
      },
    ]);
  });

  afterEach(() => {
    delete process.env.ACTUAL_MCP_STATE_DIR;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns the stored result for the same operationId and arguments', async () => {
    const args = { transaction: transactionId, schedule: scheduleId };
    const first = await executeMutation({
      operationId: 'match-operation-1',
      tool: tool.schema.name,
      args,
      mutate: () => tool.handler(args as never),
    });
    vi.clearAllMocks();

    const retried = await executeMutation({
      operationId: 'match-operation-1',
      tool: tool.schema.name,
      args,
      mutate: () => tool.handler(args as never),
    });

    expect(retried).toEqual(first);
    expect(transactionScheduleApi.getTransactionById).not.toHaveBeenCalled();
    expect(transactionScheduleApi.setTransactionSchedule).not.toHaveBeenCalled();
  });

  it('rejects the same operationId with different arguments', async () => {
    await executeMutation({
      operationId: 'match-operation-2',
      tool: tool.schema.name,
      args: { transaction: transactionId, schedule: scheduleId },
      mutate: () => tool.handler({ transaction: transactionId, schedule: scheduleId } as never),
    });

    await expect(
      executeMutation({
        operationId: 'match-operation-2',
        tool: tool.schema.name,
        args: { transaction: transactionId, schedule: 'different schedule' },
        mutate: () => tool.handler({ transaction: transactionId, schedule: 'different schedule' } as never),
      })
    ).rejects.toThrow('OPERATION_ID_CONFLICT');
  });
});

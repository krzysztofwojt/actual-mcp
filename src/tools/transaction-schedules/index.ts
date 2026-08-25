import { z } from 'zod';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import {
  getTransactionById,
  setTransactionSchedule,
  TransactionScheduleState,
} from '../../domain/transaction-schedule-api.js';
import { getSchedules } from '../../domain/schedule-api.js';
import { defineTool, ToolModule } from '../tool-factory.js';

const TransactionIdSchema = z.uuid().describe('Exact UUID of an existing transaction');
const ScheduleReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Exact schedule UUID or unique case-insensitive schedule name');

async function requireTransaction(id: string): Promise<TransactionScheduleState> {
  const transaction = await getTransactionById(id);
  if (!transaction) throw new Error(`UNKNOWN_TRANSACTION: ${id}`);
  return transaction;
}

const matchTransactionToScheduleTool = defineTool(
  'match-transaction-to-schedule',
  'Link one exact existing transaction UUID to an existing schedule UUID or unique case-insensitive name.',
  z.object({ transaction: TransactionIdSchema, schedule: ScheduleReferenceSchema }),
  async ({ transaction: transactionId, schedule: scheduleReference }) => {
    const transaction = await requireTransaction(transactionId);
    const schedules = await getSchedules();
    const selectedSchedule = resolveEntity(scheduleReference, schedules, (item) => item.name ?? '', 'schedule');
    const currentScheduleId = transaction.schedule ?? null;

    if (currentScheduleId === selectedSchedule.id) {
      return {
        transactionId,
        scheduleId: selectedSchedule.id,
        scheduleName: selectedSchedule.name ?? null,
        matched: true,
        alreadyMatched: true,
      };
    }
    if (currentScheduleId) {
      const currentSchedule = schedules.find((item) => item.id === currentScheduleId);
      throw new Error(
        `TRANSACTION_SCHEDULE_CONFLICT: ${transactionId} is already matched to ${currentSchedule?.name ?? 'schedule'} (${currentScheduleId})`
      );
    }

    await setTransactionSchedule(transaction, selectedSchedule.id);
    return {
      transactionId,
      scheduleId: selectedSchedule.id,
      scheduleName: selectedSchedule.name ?? null,
      matched: true,
    };
  }
);

const unmatchTransactionFromScheduleTool = defineTool(
  'unmatch-transaction-from-schedule',
  'Remove only the native schedule link from one exact existing transaction UUID.',
  z.object({ transaction: TransactionIdSchema }),
  async ({ transaction: transactionId }) => {
    const transaction = await requireTransaction(transactionId);
    const scheduleId = transaction.schedule ?? null;
    if (!scheduleId) {
      return { transactionId, scheduleId: null, scheduleName: null, matched: false, alreadyUnmatched: true };
    }

    const schedules = await getSchedules();
    const previousSchedule = schedules.find((item) => item.id === scheduleId);
    await setTransactionSchedule(transaction, null);
    return {
      transactionId,
      scheduleId,
      scheduleName: previousSchedule?.name ?? null,
      matched: false,
    };
  }
);

export const transactionScheduleWriteTools: ToolModule[] = [
  matchTransactionToScheduleTool,
  unmatchTransactionFromScheduleTool,
];

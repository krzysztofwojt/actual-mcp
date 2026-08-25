import * as api from '@actual-app/api';
import { TransactionEntity } from '@actual-app/core/types/models';
import { initActualApi } from '../actual-api.js';

const PROTECTED_FIELDS = ['date', 'amount', 'payee', 'category', 'notes', 'cleared', 'account'] as const;

export type TransactionScheduleState = TransactionEntity & { schedule?: string | null };

async function queryTransactionById(id: string): Promise<TransactionScheduleState | null> {
  const result = (await api.aqlQuery(api.q('transactions').filter({ id }).select('*').options({ splits: 'none' }))) as {
    data?: TransactionScheduleState[];
  };
  return result.data?.find((transaction) => transaction.id === id) ?? null;
}

/** Read one exact transaction without requiring its account or date range. */
export async function getTransactionById(id: string): Promise<TransactionScheduleState | null> {
  await initActualApi();
  return queryTransactionById(id);
}

/**
 * Set or clear the native Actual schedule link and verify the stored result.
 *
 * Actual stores this relationship in `transactions.schedule`; the public
 * updateTransaction API is the same transaction mutation path used by Actual's
 * frontend batch update.
 */
export async function setTransactionSchedule(
  before: TransactionScheduleState,
  schedule: string | null
): Promise<TransactionScheduleState> {
  await initActualApi();
  await api.updateTransaction(before.id, { schedule } as unknown as Partial<TransactionEntity>);

  // Actual 26.8.1 may resolve updateTransaction before its asynchronous write
  // is query-visible. Poll briefly instead of reporting a false readback failure.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const after = await queryTransactionById(before.id);
    if (after && (after.schedule ?? null) === schedule) {
      for (const field of PROTECTED_FIELDS) {
        if (after[field] !== before[field]) {
          throw new Error(`TRANSACTION_SCHEDULE_SIDE_EFFECT: ${before.id} changed protected field ${field}`);
        }
      }
      return after;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`TRANSACTION_SCHEDULE_READBACK_MISMATCH: ${before.id}`);
}

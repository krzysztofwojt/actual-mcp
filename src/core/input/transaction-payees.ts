import type { Payee } from '../types/domain.js';
import { resolveEntity } from './entity-resolver.js';
import { parseMoney } from './money.js';

type SubtransactionWithPayee = {
  amount: string;
  payee?: string;
  transfer_account_id?: string;
};

type TransactionWithPayees<TSubtransaction extends SubtransactionWithPayee> = {
  payee?: string;
  subtransactions?: TSubtransaction[];
};

/** Resolve parent and child payee references without ever creating or fuzzy-matching a payee. */
export function resolveTransactionPayees<TSubtransaction extends SubtransactionWithPayee>(
  transaction: TransactionWithPayees<TSubtransaction>,
  payees: Payee[]
): void {
  if (transaction.payee) {
    transaction.payee = resolveEntity(transaction.payee, payees, (item) => item.name, 'payee').id;
  }
  for (const subtransaction of transaction.subtransactions ?? []) {
    if (subtransaction.transfer_account_id) {
      const destination = subtransaction.transfer_account_id;
      const payee = payees.find((item) => item.transfer_acct === destination);
      if (!payee)
        throw new Error(`No transfer payee found for account ${destination}. Ensure the destination account exists.`);
      subtransaction.payee = payee.id;
      delete subtransaction.transfer_account_id;
    }
    if (subtransaction.payee) {
      subtransaction.payee = resolveEntity(subtransaction.payee, payees, (item) => item.name, 'payee').id;
    }
  }
}

export function hasPayeeReferences(transaction: TransactionWithPayees<SubtransactionWithPayee>): boolean {
  return Boolean(
    transaction.payee || transaction.subtransactions?.some((item) => item.payee || item.transfer_account_id)
  );
}

/** Reject invalid splits before Actual accepts them with an error marker visible only in the UI. */
export function assertSplitTotal(
  parentAmount: string | number,
  subtransactions: SubtransactionWithPayee[] | undefined
): void {
  if (!subtransactions || subtransactions.length === 0) return;
  const parentMinor = typeof parentAmount === 'number' ? parentAmount : parseMoney(parentAmount);
  const splitMinor = subtransactions.reduce((sum, item) => sum + parseMoney(item.amount), 0);
  if (parentMinor !== splitMinor) {
    throw new Error(`SPLIT_TOTAL_MISMATCH: parent ${parentMinor}, subtransactions ${splitMinor}`);
  }
}

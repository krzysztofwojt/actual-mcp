// ----------------------------
// IMPORT TRANSACTIONS TOOL
// ----------------------------

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toJSONSchema } from 'zod';
import { success, errorFromCatch } from '../../utils/response.js';
import { importTransactions } from '../../actual-api.js';
import { parseMoney } from '../../core/input/money.js';
import { ImportTransactionsArgsSchema, type ImportTransactionsArgs, ToolInput } from '../../types.js';

export const schema = {
  name: 'import-transactions',
  description:
    'Import a list of transactions into an account using reconciliation logic. ' +
    'Deduplicates via imported_id to prevent duplicates on repeated imports. ' +
    'Supports dry-run mode to preview changes without persisting them.',
  inputSchema: toJSONSchema(ImportTransactionsArgsSchema) as ToolInput,
};

export async function handler(args: ImportTransactionsArgs): Promise<CallToolResult> {
  try {
    const { accountId, transactions, defaultCleared, dryRun, reimportDeleted } =
      ImportTransactionsArgsSchema.parse(args);

    // Exact decimal strings are converted once to integer minor units for Actual's API.
    const entities = transactions.map((t) => ({
      ...t,
      account: accountId,
      amount: parseMoney(t.amount),
      subtransactions: t.subtransactions?.map((s) => ({
        ...s,
        amount: parseMoney(s.amount),
      })),
    }));

    const result = await importTransactions(accountId, entities, { defaultCleared, dryRun, reimportDeleted });

    const prefix = dryRun ? '[DRY RUN] ' : '';
    const summary =
      `${prefix}Import complete.\n` +
      `Added: ${result.added.length} transaction(s)\n` +
      `Updated: ${result.updated.length} transaction(s)\n` +
      (result.errors.length > 0 ? `Errors: ${result.errors.map((e) => e.message).join(', ')}` : 'Errors: none');

    return success(summary);
  } catch (err) {
    return errorFromCatch(err);
  }
}

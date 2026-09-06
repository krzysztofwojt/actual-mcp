// ----------------------------
// CREATE TRANSACTION TOOL
// ----------------------------

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toJSONSchema } from 'zod';
import { successWithJson, errorFromCatch, error } from '../../utils/response.js';
import { createTransaction, getAccounts, getPayees } from '../../actual-api.js';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import { assertSplitTotal, hasPayeeReferences, resolveTransactionPayees } from '../../core/input/transaction-payees.js';
import { CreateTransactionArgsSchema, type CreateTransactionArgs, ToolInput } from '../../types.js';

export const schema = {
  name: 'create-transaction',
  description:
    'Create a new transaction. Use this to add transactions to accounts. Supports transfers between accounts by specifying transfer_account_id.',
  inputSchema: toJSONSchema(CreateTransactionArgsSchema) as ToolInput,
};

/**
 * Resolve the transfer payee ID for a given destination account.
 * Each account in Actual has a corresponding payee with transfer_acct set.
 */
async function resolveTransferPayee(
  destinationAccountId: string,
  payees: Awaited<ReturnType<typeof getPayees>>
): Promise<string | null> {
  const transferPayee = payees.find((p) => p.transfer_acct === destinationAccountId);
  return transferPayee?.id ?? null;
}

export async function handler(args: CreateTransactionArgs): Promise<CallToolResult> {
  try {
    // Validate with Zod schema
    const validatedArgs = CreateTransactionArgsSchema.parse(args);

    const { account: accountReference, transfer_account_id, ...transactionData } = validatedArgs;
    const accounts = await getAccounts();
    const accountId = resolveEntity(accountReference, accounts, (item) => item.name, 'account').id;

    assertSplitTotal(transactionData.amount, transactionData.subtransactions);
    const needsPayees = Boolean(transfer_account_id) || hasPayeeReferences(transactionData);
    const payees = needsPayees ? await getPayees() : [];

    // Reason: When transfer_account_id is provided, look up the transfer payee
    // so that addTransactions (with runTransfers: true) creates the counterpart automatically.
    if (transfer_account_id) {
      const destinationId = resolveEntity(transfer_account_id, accounts, (item) => item.name, 'account').id;
      const transferPayeeId = await resolveTransferPayee(destinationId, payees);
      if (!transferPayeeId) {
        return error(`No transfer payee found for account ${destinationId}. Ensure the destination account exists.`);
      }
      transactionData.payee = transferPayeeId;
    }

    resolveTransactionPayees(transactionData, payees);

    const id: string = await createTransaction(accountId, transactionData);

    const message = transfer_account_id
      ? `Successfully created transfer transaction ${id} (counterpart created in destination account)`
      : `Successfully created transaction ${id}`;

    return successWithJson(message);
  } catch (err) {
    return errorFromCatch(err);
  }
}

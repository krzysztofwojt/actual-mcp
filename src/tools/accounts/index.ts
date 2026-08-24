import { z } from 'zod';
import { createTransaction, getAccounts, getCategories } from '../../actual-api.js';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import { formatMoney, parseMoney } from '../../core/input/money.js';
import {
  closeAccount,
  createAccount,
  deleteAccount,
  getAccountBalance,
  reopenAccount,
  updateAccount,
} from '../../domain/account-api.js';
import { defineTool, ToolModule } from '../tool-factory.js';

const ReferenceSchema = z.string().min(1).describe('Exact ID or unique case-insensitive name');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

async function account(reference: string): Promise<Awaited<ReturnType<typeof getAccounts>>[number]> {
  return resolveEntity(reference, await getAccounts(), (item) => item.name, 'account');
}

async function category(reference: string): Promise<Awaited<ReturnType<typeof getCategories>>[number]> {
  return resolveEntity(reference, await getCategories(), (item) => item.name, 'category');
}

async function accountReadback(id: string): Promise<Awaited<ReturnType<typeof getAccounts>>[number] | undefined> {
  return (await getAccounts()).find((item) => item.id === id);
}

const createAccountTool = defineTool(
  'create-account',
  'Create an on-budget or off-budget account and verify it by reading it back.',
  z.object({
    name: z.string().trim().min(1),
    offBudget: z.boolean().default(false),
    initialBalance: z.string().default('0.00').describe('Exact decimal amount, for example 123.45'),
  }),
  async ({ name, offBudget, initialBalance }) => {
    const existing = (await getAccounts()).filter(
      (item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (existing.length) throw new Error(`ACCOUNT_NAME_EXISTS: ${name}`);
    const id = await createAccount({ name, offbudget: offBudget, closed: false }, parseMoney(initialBalance));
    const created = await accountReadback(id);
    if (!created) throw new Error(`ACCOUNT_READBACK_MISSING: ${id}`);
    return { account: created };
  }
);

const updateAccountTool = defineTool(
  'update-account',
  'Rename an account or change whether it is off budget, then verify the result.',
  z.object({ account: ReferenceSchema, name: z.string().trim().min(1).optional(), offBudget: z.boolean().optional() }),
  async ({ account: reference, name, offBudget }) => {
    if (name === undefined && offBudget === undefined) throw new Error('NO_ACCOUNT_CHANGES');
    const current = await account(reference);
    await updateAccount(current.id, {
      ...(name === undefined ? {} : { name }),
      ...(offBudget === undefined ? {} : { offbudget: offBudget }),
    });
    const updated = await accountReadback(current.id);
    if (!updated) throw new Error(`ACCOUNT_READBACK_MISSING: ${current.id}`);
    if (name !== undefined && updated.name !== name) throw new Error(`ACCOUNT_READBACK_MISMATCH: name`);
    if (offBudget !== undefined && Boolean(updated.offbudget) !== offBudget)
      throw new Error(`ACCOUNT_READBACK_MISMATCH: offBudget`);
    return { account: updated };
  }
);

const closeAccountTool = defineTool(
  'close-account',
  'Close an account, optionally transferring its remaining balance, then verify it is closed.',
  z.object({
    account: ReferenceSchema,
    transferAccount: ReferenceSchema.optional(),
    transferCategory: ReferenceSchema.optional(),
  }),
  async ({ account: reference, transferAccount, transferCategory }) => {
    const current = await account(reference);
    const destination = transferAccount ? await account(transferAccount) : undefined;
    const destinationCategory = transferCategory ? await category(transferCategory) : undefined;
    if (destination?.id === current.id) throw new Error('ACCOUNT_TRANSFER_TARGET_SAME_AS_SOURCE');
    await closeAccount(current.id, destination?.id, destinationCategory?.id);
    const closed = await accountReadback(current.id);
    if (!closed?.closed) throw new Error(`ACCOUNT_CLOSE_READBACK_MISMATCH: ${current.id}`);
    return { account: closed };
  }
);

const reopenAccountTool = defineTool(
  'reopen-account',
  'Reopen a closed account and verify it is open.',
  z.object({ account: ReferenceSchema }),
  async ({ account: reference }) => {
    const current = await account(reference);
    await reopenAccount(current.id);
    const reopened = await accountReadback(current.id);
    if (!reopened || reopened.closed) throw new Error(`ACCOUNT_REOPEN_READBACK_MISMATCH: ${current.id}`);
    return { account: reopened };
  }
);

const deleteAccountTool = defineTool(
  'delete-account',
  'Permanently delete an account and verify it no longer exists.',
  z.object({ account: ReferenceSchema }),
  async ({ account: reference }) => {
    const current = await account(reference);
    await deleteAccount(current.id);
    if (await accountReadback(current.id)) throw new Error(`ACCOUNT_DELETE_READBACK_MISMATCH: ${current.id}`);
    return { deletedAccountId: current.id, deletedAccountName: current.name };
  }
);

const reconcileAccountTool = defineTool(
  'reconcile-account',
  'Create an explicit adjustment transaction so an account reaches an exact target balance.',
  z.object({
    account: ReferenceSchema,
    targetBalance: z.string().describe('Exact decimal amount, for example 123.45'),
    date: DateSchema,
    notes: z.string().max(500).optional(),
  }),
  async ({ account: reference, targetBalance, date, notes }) => {
    const current = await account(reference);
    const before = await getAccountBalance(current.id);
    const target = parseMoney(targetBalance);
    const adjustment = target - before;
    if (adjustment === 0)
      return {
        accountId: current.id,
        before: formatMoney(before),
        target: formatMoney(target),
        adjustment: '0.00',
        changed: false,
      };
    const transactionId = await createTransaction(current.id, {
      date,
      amount: formatMoney(adjustment),
      notes: notes ?? `MCP reconciliation adjustment to ${formatMoney(target)}`,
      cleared: true,
    });
    const after = await getAccountBalance(current.id);
    if (after !== target)
      throw new Error(`RECONCILIATION_READBACK_MISMATCH: expected ${formatMoney(target)}, got ${formatMoney(after)}`);
    return {
      accountId: current.id,
      transactionId,
      before: formatMoney(before),
      target: formatMoney(target),
      adjustment: formatMoney(adjustment),
      changed: true,
    };
  }
);

export const accountWriteTools: ToolModule[] = [
  createAccountTool,
  updateAccountTool,
  closeAccountTool,
  reopenAccountTool,
  deleteAccountTool,
  reconcileAccountTool,
];

import * as api from '@actual-app/api';
import { APIAccountEntity, APICategoryEntity, APICategoryGroupEntity, APIPayeeEntity } from '@actual-app/api/models';
import {
  CustomReportEntity,
  DashboardPageEntity,
  DashboardWidgetEntity,
  RuleEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';
import type { Handlers } from '@actual-app/core/types/handlers';
import { ImportTransactionEntity } from '@actual-app/core/types/models/import-transaction';
import { getActualConnection } from './integrations/actual/connection.js';
import { BudgetMonth, TransactionData, UpdateTransactionData } from './types.js';
import { parseMoney } from './core/input/money.js';
import {
  transactionContainsUpdate,
  nativeCategoryMayBeCleared,
  verifyTransactionTransfers,
  type CounterpartState,
  type TransactionRecord,
} from './domain/transaction-update-verification.js';

/**
 * Ensures the shared Actual connection is ready.
 *
 * @deprecated Use `getActualConnection().ensureReady()` directly.
 */
export function initActualApi(): Promise<void> {
  return getActualConnection().ensureReady();
}

/**
 * Drains pending work and closes the shared Actual connection.
 *
 * @deprecated Use `getActualConnection().drainAndClose()` directly.
 */
export function shutdownActualApi(): Promise<void> {
  return getActualConnection().drainAndClose();
}

/** Force a synchronization with Actual Server regardless of the configured TTL. */
export async function syncActual(): Promise<void> {
  await getActualConnection().sync();
}

/** Share one fresh synchronization across all reads in a tool or resource. */
export function withSyncedRead<T>(operation: () => Promise<T>): Promise<T> {
  return getActualConnection().withSyncedRead(operation);
}

/**
 * Returns every account in the loaded budget.
 */
export function getAccounts(): Promise<APIAccountEntity[]> {
  return getActualConnection().run(() => api.getAccounts());
}

/**
 * Returns every category in the loaded budget.
 */
export function getCategories(): Promise<(APICategoryEntity | APICategoryGroupEntity)[]> {
  return getActualConnection().run(() => api.getCategories());
}

/**
 * Returns every category group in the loaded budget.
 */
export function getCategoryGroups(): Promise<APICategoryGroupEntity[]> {
  return getActualConnection().run(() => api.getCategoryGroups());
}

/**
 * Returns every payee in the loaded budget.
 */
export function getPayees(): Promise<APIPayeeEntity[]> {
  return getActualConnection().run(() => api.getPayees());
}

/**
 * Returns transactions for an account within an inclusive date range.
 */
export function getTransactions(accountId: string, start?: string, end?: string): Promise<TransactionEntity[]> {
  return getActualConnection().run(() => api.getTransactions(accountId, start as string, end as string));
}

/**
 * Returns the months for which the loaded budget has data.
 */
export function getBudgetMonths(): Promise<string[]> {
  return getActualConnection().run(() => api.getBudgetMonths());
}

/**
 * Returns budget data for a month in `YYYY-MM` format.
 */
export function getBudgetMonth(month: string): Promise<BudgetMonth> {
  return getActualConnection().run(() => api.getBudgetMonth(month) as unknown as Promise<BudgetMonth>);
}

async function queryTransactionById(id: string): Promise<TransactionEntity | undefined> {
  const readback = (await api.aqlQuery(
    api.q('transactions').filter({ id }).select('*').options({ splits: 'grouped' })
  )) as { data?: TransactionEntity[] };
  return Array.isArray(readback?.data) ? readback.data.find((item) => item.id === id) : undefined;
}

export async function getTransactionById(id: string): Promise<TransactionEntity | undefined> {
  return getActualConnection().run(() => queryTransactionById(id));
}

/**
 * Returns an account balance, optionally as of a cutoff date.
 */
export function getAccountBalance(accountId: string, cutoff?: Date): Promise<number> {
  return getActualConnection().run(() => api.getAccountBalance(accountId, cutoff));
}

/**
 * Returns every transaction rule in the loaded budget.
 */
export function getRules(): Promise<RuleEntity[]> {
  return getActualConnection().run(() => api.getRules());
}

/**
 * Creates a payee and returns its identifier.
 */
export function createPayee(args: Record<string, unknown>): Promise<string> {
  return getActualConnection().run(() => api.createPayee(args as unknown as Omit<APIPayeeEntity, 'id'>));
}

/**
 * Updates a payee with the supplied fields.
 */
export function updatePayee(id: string, args: Record<string, unknown>): Promise<unknown> {
  return getActualConnection().run(() => api.updatePayee(id, args));
}

/**
 * Deletes a payee by identifier.
 */
export function deletePayee(id: string): Promise<unknown> {
  return getActualConnection().run(() => api.deletePayee(id));
}

/**
 * Merges payees into a target payee. Transactions referencing the merged payees are
 * reassigned to the target; rules keep working because Actual maps the merged payee IDs
 * to the target when rules are loaded.
 */
export function mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
  return getActualConnection().run(() => api.mergePayees(targetId, mergeIds));
}

/**
 * Creates a transaction rule and returns the resulting entity.
 */
export function createRule(args: Record<string, unknown>): Promise<RuleEntity> {
  return getActualConnection().run(() => api.createRule(args as unknown as Omit<RuleEntity, 'id'>));
}

/**
 * Updates an existing transaction rule.
 */
export function updateRule(args: Record<string, unknown>): Promise<RuleEntity> {
  return getActualConnection().run(() => api.updateRule(args as unknown as RuleEntity));
}

/**
 * Deletes a transaction rule by identifier.
 */
export function deleteRule(id: string): Promise<boolean> {
  return getActualConnection().run(() => api.deleteRule(id));
}

/**
 * Creates a category and returns its identifier.
 */
export function createCategory(args: Record<string, unknown>): Promise<string> {
  return getActualConnection().run(() => api.createCategory(args as unknown as Omit<APICategoryEntity, 'id'>));
}

/**
 * Updates a category with the supplied fields.
 */
export function updateCategory(id: string, args: Record<string, unknown>): Promise<unknown> {
  return getActualConnection().run(() => api.updateCategory(id, args));
}

/**
 * Deletes a category by identifier.
 */
export function deleteCategory(id: string): Promise<void> {
  return getActualConnection().run(() => api.deleteCategory(id));
}

/**
 * Creates a category group and returns its identifier.
 */
export function createCategoryGroup(args: Record<string, unknown>): Promise<string> {
  return getActualConnection().run(() =>
    api.createCategoryGroup(args as unknown as Omit<APICategoryGroupEntity, 'id'>)
  );
}

/**
 * Updates a category group with the supplied fields.
 */
export function updateCategoryGroup(id: string, args: Record<string, unknown>): Promise<unknown> {
  return getActualConnection().run(() => api.updateCategoryGroup(id, args));
}

/**
 * Deletes a category group by identifier.
 */
export function deleteCategoryGroup(id: string): Promise<unknown> {
  return getActualConnection().run(() => api.deleteCategoryGroup(id));
}

/**
 * Adds a transaction to an account and returns its identifier.
 */
export async function createTransaction(accountId: string, data: TransactionData): Promise<string> {
  return getActualConnection().run(async () => {
    const before = await api.getTransactions(accountId, data.date, data.date);
    const converted = {
      ...data,
      amount: parseMoney(data.amount),
      ...(data.subtransactions && data.subtransactions.length > 0 ? { category: undefined } : {}),
      subtransactions: data.subtransactions?.map((item) => ({ ...item, amount: parseMoney(item.amount) })),
    };
    await api.addTransactions(accountId, [converted], { runTransfers: true });
    const previousIds = new Set(before.map((item) => item.id));
    const created = (await api.getTransactions(accountId, data.date, data.date)).filter(
      (item) => !previousIds.has(item.id) && item.amount === converted.amount
    );
    if (created.length !== 1) {
      throw new Error(`TRANSACTION_CREATE_READBACK_MISMATCH: expected one new transaction, found ${created.length}`);
    }
    if (converted.subtransactions && converted.subtransactions.length > 0) {
      const stored = await queryTransactionById(created[0].id);
      if (
        !stored ||
        !transactionContainsUpdate(stored as unknown as Record<string, unknown>, {
          amount: converted.amount,
          subtransactions: converted.subtransactions,
        })
      ) {
        throw new Error(`TRANSACTION_CREATE_READBACK_MISMATCH: split ${created[0].id}`);
      }
    }
    return created[0].id;
  });
}

/**
 * Imports transactions using Actual's reconciliation and deduplication logic.
 */
export function importTransactions(
  accountId: string,
  transactions: ImportTransactionEntity[],
  opts?: { defaultCleared?: boolean; dryRun?: boolean; reimportDeleted?: boolean }
): Promise<{ added: string[]; updated: string[]; errors: Array<{ message: string }> }> {
  return getActualConnection().run(() => api.importTransactions(accountId, transactions, opts));
}

/**
 * Updates a transaction with the supplied fields.
 */
export async function updateTransaction(id: string, data: UpdateTransactionData): Promise<unknown> {
  return getActualConnection().run(async () => {
    const converted = {
      ...data,
      ...(data.amount === undefined ? {} : { amount: parseMoney(data.amount) }),
      ...(data.subtransactions && data.subtransactions.length > 0 ? { category: null } : {}),
      ...(data.subtransactions === undefined
        ? {}
        : { subtransactions: data.subtransactions.map((item) => ({ ...item, amount: parseMoney(item.amount) })) }),
    };
    const before = await queryTransactionById(id);
    // Resolve transfer metadata before mutation: a lookup failure must not follow a write.
    const hasSplit = Boolean(converted.subtransactions || before?.subtransactions?.length);
    const needsTransferMetadata = hasSplit || Boolean(before?.transfer_id) || converted.payee !== undefined;
    const payees = needsTransferMetadata ? await api.getPayees() : [];
    const accounts = needsTransferMetadata ? await api.getAccounts() : [];
    const categoryMayBeCleared = nativeCategoryMayBeCleared(converted.account ?? before?.account, accounts, payees);
    if (converted.subtransactions && before) {
      const total = converted.subtransactions.reduce((sum, child) => sum + Number(child.amount), 0);
      if (converted.subtransactions.length === 0 || total !== (converted.amount ?? before.amount)) {
        throw new Error(`SPLIT_TOTAL_MISMATCH: ${id}. No write attempted.`);
      }
    }
    let mutationError: unknown;
    try {
      await api.updateTransaction(id, converted as unknown as Partial<TransactionEntity>);
    } catch (error) {
      mutationError = error;
    }

    let stored: TransactionRecord | undefined;
    let counterparts: TransactionRecord[] = [];
    let counterpartStates: CounterpartState[] = [];
    let readbackError: unknown;
    // Actual 26.8.1 returns undefined while the asynchronous native write continues.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        stored = (await queryTransactionById(id)) as unknown as TransactionRecord | undefined;
        if (stored) {
          const transferState = await verifyTransactionTransfers(
            before as unknown as TransactionRecord | undefined,
            stored,
            payees,
            async (counterpartId) =>
              (await queryTransactionById(counterpartId)) as unknown as TransactionRecord | undefined
          );
          counterparts = transferState.counterparts;
          counterpartStates = transferState.counterpartStates;
          if (
            transactionContainsUpdate(stored, converted as TransactionRecord, categoryMayBeCleared) &&
            transferState.matches
          )
            return [stored];
        }
        readbackError = undefined;
      } catch (error) {
        readbackError = error;
      }
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // # Reason: automatic rollback could overwrite concurrent bank/client edits.
    // Report observed state explicitly instead of pretending a failed check undid the write.
    throw new Error(
      `TRANSACTION_UPDATE_READBACK_MISMATCH: ${id}. ` +
        JSON.stringify({
          writeAttempted: true,
          rollbackPerformed: false,
          state: readbackError ? 'unknown' : 'observed_after_write',
          retrySafe: false,
          before: before ?? null,
          observed: stored ?? null,
          counterparts,
          counterpartStates,
          readbackError: readbackError instanceof Error ? readbackError.message : readbackError,
          mutationError: mutationError instanceof Error ? mutationError.message : mutationError,
        })
    );
  });
}

/**
 * Deletes a transaction by identifier.
 */
export function deleteTransaction(id: string): Promise<unknown> {
  return getActualConnection().run(() => api.deleteTransaction(id));
}

/**
 * Runs bank synchronization for one account or all linked accounts.
 */
export function runBankSync(accountId?: string): Promise<void> {
  return getActualConnection().run(() => api.runBankSync(accountId ? { accountId } : undefined));
}

/**
 * Invokes an Actual server handler through the initialized connection handle.
 */
async function send<K extends keyof Handlers>(name: K, args?: Parameters<Handlers[K]>[0]): Promise<unknown> {
  return getActualConnection().run((actualLib) => actualLib.send(name, args));
}

/**
 * Selects every row from an Actual query table.
 */
async function query<T>(tableName: string): Promise<T[]> {
  return getActualConnection().run(async (actualLib) => {
    const result = (await api.aqlQuery(actualLib.q(tableName).select('*'))) as { data: T[] };
    return result.data ?? [];
  });
}

/**
 * Returns every custom report in the loaded budget.
 */
export async function getReports(): Promise<CustomReportEntity[]> {
  return (await send('report/get')) as CustomReportEntity[];
}

/**
 * Creates a custom report and returns its identifier.
 */
export async function createReport(report: CustomReportEntity): Promise<string> {
  return (await send('report/create', report)) as string;
}

/**
 * Updates an existing custom report.
 */
export async function updateReport(report: CustomReportEntity): Promise<void> {
  await send('report/update', report);
}

/**
 * Deletes a custom report by identifier.
 */
export async function deleteReport(id: string): Promise<void> {
  await send('report/delete', id);
}

/**
 * Returns every active dashboard page.
 */
export async function getDashboardPages(): Promise<DashboardPageEntity[]> {
  return (await query<DashboardPageEntity>('dashboard_pages')).filter((page) => !page.tombstone);
}

/**
 * Returns every active dashboard widget.
 */
export async function getDashboardWidgets(): Promise<DashboardWidgetEntity[]> {
  return (await query<DashboardWidgetEntity>('dashboard')).filter((widget) => !widget.tombstone);
}

/**
 * Adds a widget to a dashboard.
 */
export async function addDashboardWidget(widget: Record<string, unknown>): Promise<void> {
  await send('dashboard-add-widget', widget as Parameters<Handlers['dashboard-add-widget']>[0]);
}

/**
 * Updates an existing dashboard widget.
 */
export async function updateDashboardWidget(widget: Record<string, unknown>): Promise<void> {
  await send('dashboard-update-widget', widget as Parameters<Handlers['dashboard-update-widget']>[0]);
}

/**
 * Removes a widget from a dashboard.
 */
export async function removeDashboardWidget(widgetId: string): Promise<void> {
  await send('dashboard-remove-widget', widgetId);
}

/**
 * Replaces the dashboard's widget configuration.
 */
export async function updateDashboard(widgets: Array<Record<string, unknown>>): Promise<void> {
  await send('dashboard-update', widgets as Parameters<Handlers['dashboard-update']>[0]);
}

/**
 * Creates a dashboard page and returns its identifier.
 */
export async function createDashboardPage(name: string): Promise<string> {
  return (await send('dashboard-create', { name })) as string;
}

/**
 * Renames a dashboard page.
 */
export async function renameDashboardPage(id: string, name: string): Promise<void> {
  await send('dashboard-rename', { id, name });
}

/**
 * Deletes a dashboard page by identifier.
 */
export async function deleteDashboardPage(id: string): Promise<void> {
  await send('dashboard-delete', id);
}

/**
 * Sets the budgeted amount for a category and month.
 */
export function setBudgetAmount(month: string, categoryId: string, value: number): Promise<void> {
  return getActualConnection().run(() => api.setBudgetAmount(month, categoryId, value));
}

/**
 * Enables or disables category carryover for a month.
 */
export function setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
  return getActualConnection().run(() => api.setBudgetCarryover(month, categoryId, flag));
}

/**
 * Holds an amount from a month for use in the following month.
 */
export function holdBudgetForNextMonth(month: string, value: number): Promise<boolean> {
  return getActualConnection().run(() => api.holdBudgetForNextMonth(month, value));
}

/**
 * Clears a previously configured budget hold for a month.
 */
export function resetBudgetHold(month: string): Promise<void> {
  return getActualConnection().run(() => api.resetBudgetHold(month));
}

// ----------------------------
// TOOLS
// ----------------------------

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { withSyncedRead } from '../actual-api.js';
import { executeMutation, withoutOperationId } from '../core/runtime/operation-runtime.js';
import { withBudgetLock } from '../core/runtime/operation-queue.js';
import { error, errorFromCatch } from '../utils/response.js';

import * as balanceHistory from './balance-history/index.js';
import * as getCustomReports from './custom-reports/get-custom-reports/index.js';
import * as createCustomReport from './custom-reports/create-custom-report/index.js';
import * as updateCustomReport from './custom-reports/update-custom-report/index.js';
import * as deleteCustomReport from './custom-reports/delete-custom-report/index.js';
import * as getDashboards from './dashboards/get-dashboards/index.js';
import * as addDashboardWidget from './dashboards/add-dashboard-widget/index.js';
import * as updateDashboardWidget from './dashboards/update-dashboard-widget/index.js';
import * as removeDashboardWidget from './dashboards/remove-dashboard-widget/index.js';
import * as organizeDashboard from './dashboards/organize-dashboard/index.js';
import * as createDashboardPage from './dashboards/create-dashboard-page/index.js';
import * as renameDashboardPage from './dashboards/rename-dashboard-page/index.js';
import * as deleteDashboardPage from './dashboards/delete-dashboard-page/index.js';
import * as budgetVsActual from './budget-vs-actual/index.js';
import * as cashFlow from './cash-flow/index.js';
import * as categoryTrends from './category-trends/index.js';
import * as netWorth from './net-worth/index.js';
import * as spendingByPayee from './spending-by-payee/index.js';
import * as createCategoryGroup from './categories/create-category-group/index.js';
import * as createCategory from './categories/create-category/index.js';
import * as deleteCategoryGroup from './categories/delete-category-group/index.js';
import * as deleteCategory from './categories/delete-category/index.js';
import * as getGroupedCategories from './categories/get-grouped-categories/index.js';
import * as updateCategoryGroup from './categories/update-category-group/index.js';
import * as updateCategory from './categories/update-category/index.js';
import * as getAccounts from './get-accounts/index.js';
import * as getTransactions from './get-transactions/index.js';
import * as monthlySummary from './monthly-summary/index.js';
import * as createPayee from './payees/create-payee/index.js';
import * as deletePayee from './payees/delete-payee/index.js';
import * as getPayees from './payees/get-payees/index.js';
import * as mergePayees from './payees/merge-payees/index.js';
import * as updatePayee from './payees/update-payee/index.js';
import * as createRule from './rules/create-rule/index.js';
import * as deleteRule from './rules/delete-rule/index.js';
import * as getRules from './rules/get-rules/index.js';
import * as updateRule from './rules/update-rule/index.js';
import * as spendingByCategory from './spending-by-category/index.js';
import * as deleteTransaction from './delete-transaction/index.js';
import * as updateTransaction from './update-transaction/index.js';
import * as getBudgetMonths from './budgets/get-budget-months/index.js';
import * as getBudgetMonth from './budgets/get-budget-month/index.js';
import * as setBudgetAmount from './budgets/set-budget-amount/index.js';
import * as setBudgetCarryover from './budgets/set-budget-carryover/index.js';
import * as holdBudgetForNextMonth from './budgets/hold-budget-for-next-month/index.js';
import * as resetBudgetHold from './budgets/reset-budget-hold/index.js';
import * as createTransaction from './create-transaction/index.js';
import * as importTransactions from './import-transactions/index.js';
import * as runBankSync from './run-bank-sync/index.js';
import * as bankSyncStatus from './bank-sync-status/index.js';
import { budgetReadTools, budgetWriteTools } from './budget/index.js';
import { accountWriteTools } from './accounts/index.js';
import { metadataReadTools, metadataWriteTools } from './metadata/index.js';
import { scheduleReadTools, scheduleWriteTools } from './schedules/index.js';
import { transactionScheduleWriteTools } from './transaction-schedules/index.js';

// Later fork definitions retain strict money validation and readback for overlapping tools.
function uniqueTools<T extends { schema: { name: string } }>(tools: T[]): T[] {
  return [...new Map(tools.map((tool) => [tool.schema.name, tool])).values()];
}

const readTools = uniqueTools([
  getTransactions,
  spendingByCategory,
  monthlySummary,
  balanceHistory,
  budgetVsActual,
  netWorth,
  categoryTrends,
  spendingByPayee,
  cashFlow,
  getAccounts,
  getGroupedCategories,
  getPayees,
  getRules,
  getCustomReports,
  getDashboards,
  getBudgetMonths,
  getBudgetMonth,
  bankSyncStatus,
  ...budgetReadTools,
  ...metadataReadTools,
  ...scheduleReadTools,
]);

const writeTools = uniqueTools([
  createCategory,
  updateCategory,
  deleteCategory,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  createPayee,
  updatePayee,
  deletePayee,
  mergePayees,
  createRule,
  updateRule,
  deleteRule,
  updateTransaction,
  deleteTransaction,
  createTransaction,
  importTransactions,
  runBankSync,
  createCustomReport,
  updateCustomReport,
  deleteCustomReport,
  addDashboardWidget,
  updateDashboardWidget,
  removeDashboardWidget,
  organizeDashboard,
  createDashboardPage,
  renameDashboardPage,
  deleteDashboardPage,
  setBudgetAmount,
  setBudgetCarryover,
  holdBudgetForNextMonth,
  resetBudgetHold,
  ...budgetWriteTools,
  ...accountWriteTools,
  ...metadataWriteTools,
  ...scheduleWriteTools,
  ...transactionScheduleWriteTools,
]);

const writeToolNames = new Set(writeTools.map((tool) => tool.schema.name));

function schemaWithOperationId(schema: Tool): Tool {
  return {
    ...schema,
    inputSchema: {
      ...schema.inputSchema,
      properties: {
        ...schema.inputSchema.properties,
        operationId: {
          type: 'string',
          minLength: 8,
          description: 'Required idempotency key. Reusing it with the same arguments returns the prior result.',
        },
      },
      required: [...new Set([...(schema.inputSchema.required ?? []), 'operationId'])],
    },
  };
}

export const setupTools = (server: Server, enableWrite: boolean): void => {
  // Selecting available tools based on permissions
  const allTools = enableWrite ? [...readTools, ...writeTools] : readTools;

  /**
   * Handler for listing available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, () => {
    return {
      tools: allTools.map((tool) =>
        writeToolNames.has(tool.schema.name) ? schemaWithOperationId(tool.schema as Tool) : (tool.schema as Tool)
      ),
    };
  });

  /**
   * Handler for calling tools
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: rawArgs } = request.params;

      const tool = allTools.find((t) => t.schema.name === name);
      if (!tool) {
        return error(`Unknown tool ${name}`);
      }

      // Job status is durable local state and must remain observable while a long bank sync owns the budget lock.
      if (name === 'get-bank-sync-status') {
        // @ts-expect-error: Argument type is handled by the tool schema.
        return tool.handler((rawArgs ?? {}) as Record<string, unknown>);
      }

      return await withBudgetLock(async () => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        if (!writeToolNames.has(name)) {
          // @ts-expect-error: Argument type is handled by the tool schema.
          return withSyncedRead(() => tool.handler(args));
        }
        if (typeof args.operationId !== 'string' || args.operationId.length < 8) {
          return error('operationId is required for every mutating tool and must contain at least 8 characters');
        }
        const cleanArgs = withoutOperationId(args);
        return executeMutation({
          operationId: args.operationId,
          tool: name,
          args: cleanArgs,
          // @ts-expect-error: Argument type is handled by the tool schema.
          mutate: () => tool.handler(cleanArgs),
        });
      });
    } catch (err) {
      return errorFromCatch(err);
    }
  });
};

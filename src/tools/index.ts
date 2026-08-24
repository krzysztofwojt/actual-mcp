// ----------------------------
// TOOLS
// ----------------------------

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { syncActual } from '../actual-api.js';
import { executeMutation, withoutOperationId } from '../core/runtime/operation-runtime.js';
import { withBudgetLock } from '../core/runtime/operation-queue.js';
import { error, errorFromCatch } from '../utils/response.js';

import * as balanceHistory from './balance-history/index.js';
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
import * as updatePayee from './payees/update-payee/index.js';
import * as createRule from './rules/create-rule/index.js';
import * as deleteRule from './rules/delete-rule/index.js';
import * as getRules from './rules/get-rules/index.js';
import * as updateRule from './rules/update-rule/index.js';
import * as spendingByCategory from './spending-by-category/index.js';
import * as deleteTransaction from './delete-transaction/index.js';
import * as updateTransaction from './update-transaction/index.js';
import * as createTransaction from './create-transaction/index.js';
import * as importTransactions from './import-transactions/index.js';
import * as runBankSync from './run-bank-sync/index.js';
import * as bankSyncStatus from './bank-sync-status/index.js';
import { budgetReadTools, budgetWriteTools } from './budget/index.js';
import { accountWriteTools } from './accounts/index.js';
import { metadataReadTools, metadataWriteTools } from './metadata/index.js';
import { scheduleReadTools, scheduleWriteTools } from './schedules/index.js';

const readTools = [
  getTransactions,
  spendingByCategory,
  monthlySummary,
  balanceHistory,
  getAccounts,
  getGroupedCategories,
  getPayees,
  getRules,
  bankSyncStatus,
  ...budgetReadTools,
  ...metadataReadTools,
  ...scheduleReadTools,
];

const writeTools = [
  createCategory,
  updateCategory,
  deleteCategory,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  createPayee,
  updatePayee,
  deletePayee,
  createRule,
  updateRule,
  deleteRule,
  updateTransaction,
  deleteTransaction,
  createTransaction,
  importTransactions,
  runBankSync,
  ...budgetWriteTools,
  ...accountWriteTools,
  ...metadataWriteTools,
  ...scheduleWriteTools,
];

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
          await syncActual();
          // @ts-expect-error: Argument type is handled by the tool schema.
          return tool.handler(args);
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
      console.error(`Error executing tool ${request.params.name}:`, err);
      return errorFromCatch(err);
    }
  });
};

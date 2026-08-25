// Type definitions for Actual Budget API
export type { Account, Transaction, Category, CategoryGroup, Payee } from './core/types/domain.js';
import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AccountReferenceSchema, DateSchema, PositiveIntegerSchema } from './core/input/schemas.js';

const MoneyStringSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/, 'amount must be an exact decimal string such as 123.45');
const MoneyInputSchema = MoneyStringSchema;

export type ToolInput = Tool['inputSchema'];

export interface BudgetFile {
  id?: string;
  cloudFileId?: string;
  name: string;
}

// Type definitions for tool arguments
export const GetTransactionsArgsSchema = z.object({
  accountId: AccountReferenceSchema.describe('Actual Budget account ID.'),
  startDate: DateSchema.optional().describe(
    'Inclusive lower bound in YYYY-MM-DD. If omitted, no lower date bound is applied.'
  ),
  endDate: DateSchema.optional().describe(
    'Inclusive upper bound in YYYY-MM-DD. If omitted, no upper date bound is applied.'
  ),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  categoryName: z.string().optional(),
  payeeName: z.string().optional(),
  limit: PositiveIntegerSchema.optional().describe(
    'Maximum number of matching transactions to return. If omitted, return all matching transactions.'
  ),
});

export type GetTransactionsArgs = z.infer<typeof GetTransactionsArgsSchema>;

export const SpendingByCategoryArgsSchema = z.object({
  startDate: DateSchema.optional().describe(
    'Inclusive lower bound in YYYY-MM-DD. If omitted, no lower date bound is applied.'
  ),
  endDate: DateSchema.optional().describe(
    'Inclusive upper bound in YYYY-MM-DD. If omitted, no upper date bound is applied.'
  ),
  accountId: AccountReferenceSchema.optional().describe('Account ID. If omitted, use all open on-budget accounts.'),
  includeIncome: z.boolean().optional().default(false).describe('Include income categories. Defaults to false.'),
});

export type SpendingByCategoryArgs = z.input<typeof SpendingByCategoryArgsSchema>;

export const MonthlySummaryArgsSchema = z.object({
  months: PositiveIntegerSchema.optional().default(3).describe('Number of calendar months to analyze. Defaults to 3.'),
  accountId: AccountReferenceSchema.optional().describe('Account ID. If omitted, use all open on-budget accounts.'),
});

export type MonthlySummaryArgs = z.input<typeof MonthlySummaryArgsSchema>;

export const BalanceHistoryArgsSchema = z.object({
  accountId: AccountReferenceSchema.optional().describe(
    'Account ID. If omitted, aggregate open accounts selected by includeOffBudget.'
  ),
  includeOffBudget: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include open off-budget accounts in an aggregate report. Defaults to false.'),
  months: PositiveIntegerSchema.optional().default(3).describe('Number of calendar months to analyze. Defaults to 3.'),
});

export type BalanceHistoryArgs = z.input<typeof BalanceHistoryArgsSchema>;

export const FinancialInsightsArgsSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type FinancialInsightsArgs = z.infer<typeof FinancialInsightsArgsSchema>;

export const BudgetReviewArgsSchema = z.object({
  months: z.number().optional().default(3),
});

export type BudgetReviewArgs = z.infer<typeof BudgetReviewArgsSchema>;

export const UpdateSubtransactionSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('The ID of an existing subtransaction to update. Omit to add a new subtransaction.'),
  amount: MoneyInputSchema.describe('Required exact decimal amount, for example -12.34'),
  category: z.string().optional().describe('The ID of the category for this subtransaction'),
  notes: z.string().optional().describe('Any additional notes for this subtransaction'),
});

export type UpdateSubtransaction = z.infer<typeof UpdateSubtransactionSchema>;

export const UpdateTransactionArgsSchema = z.object({
  id: z.string().describe('Required. The ID of the transaction to update'),
  account: z.string().optional().describe('Exact account ID or unique account name to move this transaction to'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
    .optional()
    .describe('Transaction date in YYYY-MM-DD format'),
  amount: MoneyInputSchema.optional().describe('Exact decimal amount, for example -12.34'),
  payee: z.string().optional().describe('An existing payee ID'),
  imported_payee: z
    .string()
    .optional()
    .describe(
      'This can be anything. Meant to represent the raw description when importing, allowing the user to see the original value'
    ),
  category: z.string().optional().describe('The ID of the category to assign to this transaction'),
  notes: z.string().optional().describe('Any additional notes for the transaction'),
  imported_id: z
    .string()
    .optional()
    .describe('A unique id usually given by the bank, if importing. Use this to avoid duplicate transactions'),
  cleared: z.boolean().optional().describe('A flag indicating if the transaction has cleared or not'),
  subtransactions: z
    .array(UpdateSubtransactionSchema)
    .optional()
    .describe(
      "An array of subtransactions for a split transaction. Replaces existing subtransactions. If amounts don't equal total amount, API call will succeed but error will show in app"
    ),
});

export type UpdateTransactionArgs = z.infer<typeof UpdateTransactionArgsSchema>;

// Schema for update data passed to the API (without id, which is passed separately)
export const UpdateTransactionDataSchema = UpdateTransactionArgsSchema.omit({ id: true });
export type UpdateTransactionData = z.infer<typeof UpdateTransactionDataSchema>;

export const SubtransactionSchema = z.object({
  amount: MoneyInputSchema.describe('Required exact decimal amount, for example -12.34'),
  category: z.string().optional().describe('The ID of the category for this subtransaction'),
  notes: z.string().optional().describe('Any additional notes for this subtransaction'),
});

export type Subtransaction = z.infer<typeof SubtransactionSchema>;

export const CreateTransactionArgsSchema = z.object({
  account: z.string().describe('Required. Exact account ID or unique case-insensitive account name'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
    .describe('Required. Transaction date in YYYY-MM-DD format'),
  amount: MoneyInputSchema.describe('Required exact decimal amount, for example -12.34'),
  payee: z.string().optional().describe('An existing payee ID. This overrides payee_name if both are provided.'),
  payee_name: z
    .string()
    .optional()
    .describe(
      'If given, a payee will be created with this name. If this matches an already existing payee, that payee will be used.'
    ),
  imported_payee: z
    .string()
    .optional()
    .describe(
      'This can be anything. Meant to represent the raw description when importing, allowing the user to see the original value'
    ),
  category: z.string().optional().describe('Recommended. The ID of the category to assign to this transaction'),
  notes: z.string().optional().describe('Any additional notes for the transaction'),
  imported_id: z
    .string()
    .optional()
    .describe('A unique id usually given by the bank, if importing. Use this to avoid duplicate transactions'),
  transfer_id: z
    .string()
    .optional()
    .describe(
      'If a transfer, the id of the corresponding transaction in the other account. Only set this when importing'
    ),
  transfer_account_id: z
    .string()
    .optional()
    .describe(
      'The ID of the destination account for a transfer. When provided, the transfer payee is automatically resolved and the counterpart transaction is created in the destination account. The amount should be negative (money leaving the source account).'
    ),
  cleared: z.boolean().optional().describe('A flag indicating if the transaction has cleared or not'),
  subtransactions: z
    .array(SubtransactionSchema)
    .optional()
    .describe(
      "An array of subtransactions for a split transaction. If amounts don't equal total amount, API call will succeed but error will show in app"
    ),
});

export type CreateTransactionArgs = z.infer<typeof CreateTransactionArgsSchema>;

// Schema for transaction data passed to the API (without account and transfer_account_id, which are handled separately)
export const TransactionDataSchema = CreateTransactionArgsSchema.omit({ account: true, transfer_account_id: true });
export type TransactionData = z.infer<typeof TransactionDataSchema>;

// Import amounts use exact decimal strings and are converted to integer minor units by the handler.
export const ImportSubtransactionSchema = z.object({
  amount: MoneyStringSchema.describe('Required exact decimal amount, for example -3.24'),
  category: z.string().optional().describe('The ID of the category for this subtransaction'),
  notes: z.string().optional().describe('Any additional notes for this subtransaction'),
});

// Schema for a single transaction item in a bulk import.
// Accepts exact decimal strings which are converted to integer minor units by the handler.
export const ImportTransactionItemSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
    .describe('Required. Transaction date in YYYY-MM-DD format'),
  amount: MoneyStringSchema.describe('Required exact decimal amount, for example -3.24'),
  payee: z.string().optional().describe('An existing payee ID. This overrides payee_name if both are provided.'),
  payee_name: z
    .string()
    .optional()
    .describe(
      'If given, a payee will be created with this name. If this matches an already existing payee, that payee will be used.'
    ),
  imported_payee: z
    .string()
    .optional()
    .describe(
      'This can be anything. Meant to represent the raw description when importing, allowing the user to see the original value'
    ),
  category: z.string().optional().describe('Recommended. The ID of the category to assign to this transaction'),
  notes: z.string().optional().describe('Any additional notes for the transaction'),
  imported_id: z
    .string()
    .optional()
    .describe('A unique id usually given by the bank, if importing. Use this to avoid duplicate transactions'),
  transfer_id: z
    .string()
    .optional()
    .describe(
      'If a transfer, the id of the corresponding transaction in the other account. Only set this when importing'
    ),
  cleared: z.boolean().optional().describe('A flag indicating if the transaction has cleared or not'),
  subtransactions: z
    .array(ImportSubtransactionSchema)
    .optional()
    .describe(
      "An array of subtransactions for a split transaction. If amounts don't equal total amount, API call will succeed but error will show in app"
    ),
});

export type ImportTransactionItem = z.infer<typeof ImportTransactionItemSchema>;

export const ImportTransactionsArgsSchema = z.object({
  accountId: z.string().describe('Required. The ID of the account to import transactions into'),
  transactions: z
    .array(ImportTransactionItemSchema)
    .min(1)
    .describe('Required. List of transactions to import. Use imported_id to avoid duplicate imports on repeated runs.'),
  defaultCleared: z
    .boolean()
    .optional()
    .describe('Default cleared state for all imported transactions (can be overridden per transaction)'),
  dryRun: z.boolean().optional().describe('If true, validate and preview the import without persisting any changes'),
  reimportDeleted: z.boolean().optional().describe('Allow a previously deleted imported_id to be imported again'),
});

export type ImportTransactionsArgs = z.infer<typeof ImportTransactionsArgsSchema>;

// Additional types used in implementation
export interface CategoryGroupInfo {
  id: string;
  name: string;
  isIncome: boolean;
  isSavingsOrInvestment: boolean;
}

export interface CategorySpending {
  name: string;
  group: string;
  isIncome: boolean;
  total: number;
  transactions: number;
}

export interface GroupSpending {
  name: string;
  total: number;
  categories: CategorySpending[];
}

export interface MonthData {
  year: number;
  month: number;
  income: number;
  expenses: number;
  investments: number;
  transactions: number;
}

export interface MonthBalance {
  year: number;
  month: number;
  balance: number;
  transactions: number;
}

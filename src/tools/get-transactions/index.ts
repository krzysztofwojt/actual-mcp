// Orchestrator for get-transactions tool
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GetTransactionsInputParser } from './input-parser.js';
import { GetTransactionsDataFetcher } from './data-fetcher.js';
import { GetTransactionsMapper } from './transaction-mapper.js';
import { GetTransactionsReportGenerator } from './report-generator.js';
import { success, errorFromCatch } from '../../utils/response.js';
import { GetTransactionsArgsSchema, type GetTransactionsArgs, type ToolInput } from '../../types.js';
import { toJSONSchema } from 'zod';

export const schema = {
  name: 'get-transactions',
  description: 'Get transactions for an account with optional filters and no implicit date range or result limit',
  inputSchema: toJSONSchema(GetTransactionsArgsSchema) as ToolInput,
};

export async function handler(args: GetTransactionsArgs): Promise<CallToolResult> {
  try {
    const input = new GetTransactionsInputParser().parse(args);
    const { accountId, startDate, endDate, minAmount, maxAmount, categoryName, payeeName, limit } = input;

    // Fetch transactions
    const transactions = await new GetTransactionsDataFetcher().fetch(accountId, startDate, endDate);
    let filtered = [...transactions];

    if (minAmount !== undefined) {
      filtered = filtered.filter((t) => t.amount >= minAmount * 100);
    }
    if (maxAmount !== undefined) {
      filtered = filtered.filter((t) => t.amount <= maxAmount * 100);
    }
    if (categoryName) {
      const lowerCategory = categoryName.toLowerCase();
      filtered = filtered.filter((t) => (t.category_name || '').toLowerCase().includes(lowerCategory));
    }
    if (payeeName) {
      const lowerPayee = payeeName.toLowerCase();
      filtered = filtered.filter((t) => (t.payee_name || '').toLowerCase().includes(lowerPayee));
    }
    if (limit !== undefined && filtered.length > limit) {
      filtered = filtered.slice(0, limit);
    }

    // Map transactions for output
    const mapped = new GetTransactionsMapper().map(filtered);

    // Build filter description
    const filterDescription = [
      startDate ? `Date on or after: ${startDate}` : null,
      endDate ? `Date on or before: ${endDate}` : null,
      minAmount !== undefined ? `Min amount: $${minAmount.toFixed(2)}` : null,
      maxAmount !== undefined ? `Max amount: $${maxAmount.toFixed(2)}` : null,
      categoryName ? `Category: ${categoryName}` : null,
      payeeName ? `Payee: ${payeeName}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const markdown = new GetTransactionsReportGenerator().generate(
      mapped,
      filterDescription,
      filtered.length,
      transactions.length
    );
    return success(markdown);
  } catch (err) {
    return errorFromCatch(err);
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler, schema } from './index.js';
import { GetTransactionsDataFetcher } from './data-fetcher.js';
import type { Transaction } from '../../core/types/domain.js';

const transactions: Transaction[] = [
  {
    id: 'old-accounting',
    account: 'acc-1',
    date: '2020-02-01',
    amount: -1000,
    payee_name: 'Legacy Accountant',
    category_name: '💵 Księgowość',
  },
  {
    id: 'recent-accounting',
    account: 'acc-1',
    date: '2025-06-01',
    amount: -2000,
    payee_name: 'Current Accountant',
    category_name: '💵 Księgowość',
  },
  {
    id: 'recent-other',
    account: 'acc-1',
    date: '2025-07-01',
    amount: -3000,
    payee_name: 'Cafe',
    category_name: 'Other',
  },
];

function textOf(result: Awaited<ReturnType<typeof handler>>): string {
  const content = result.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Expected text response');
  }
  return content.text;
}

describe('get-transactions date and limit semantics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the complete account history when no date range is supplied', async () => {
    const fetch = vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockResolvedValue(transactions);

    await handler({ accountId: 'acc-1' });

    expect(fetch).toHaveBeenCalledWith('acc-1', undefined, undefined);
  });

  it('applies only the inclusive lower bound when only startDate is supplied', async () => {
    const fetch = vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockResolvedValue(transactions.slice(1));

    const result = await handler({ accountId: 'acc-1', startDate: '2025-01-01' });

    expect(fetch).toHaveBeenCalledWith('acc-1', '2025-01-01', undefined);
    expect(textOf(result)).not.toContain('| 2020-02-01 |');
  });

  it('applies only the inclusive upper bound when only endDate is supplied', async () => {
    const fetch = vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockResolvedValue([transactions[0]]);

    const result = await handler({ accountId: 'acc-1', endDate: '2024-12-31' });

    expect(fetch).toHaveBeenCalledWith('acc-1', undefined, '2024-12-31');
    expect(textOf(result)).toContain('Matching Transactions: 1/1');
  });

  it('passes both inclusive bounds for a complete date range', async () => {
    const fetch = vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockResolvedValue(transactions.slice(1));

    await handler({ accountId: 'acc-1', startDate: '2025-01-01', endDate: '2025-12-31' });

    expect(fetch).toHaveBeenCalledWith('acc-1', '2025-01-01', '2025-12-31');
  });

  it('finds the same full-history category matches with no startDate as with an early startDate', async () => {
    vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockImplementation(async (_accountId, startDate) =>
      startDate === undefined || startDate === '2000-01-01' ? transactions : transactions.slice(1)
    );

    const unbounded = await handler({ accountId: 'acc-1', categoryName: '💵 Księgowość' });
    const explicitEarlyBound = await handler({
      accountId: 'acc-1',
      startDate: '2000-01-01',
      categoryName: '💵 Księgowość',
    });

    expect(textOf(unbounded)).toContain('Matching Transactions: 2/3');
    expect(textOf(unbounded).match(/^\| .*accounting .*\|$/gm)).toEqual(
      textOf(explicitEarlyBound).match(/^\| .*accounting .*\|$/gm)
    );
  });

  it('applies a payee filter to the complete unbounded history', async () => {
    vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockImplementation(async (_accountId, startDate) =>
      startDate === undefined ? transactions : transactions.slice(1)
    );

    const result = await handler({ accountId: 'acc-1', payeeName: 'Legacy Accountant' });

    expect(textOf(result)).toContain('Matching Transactions: 1/3');
    expect(textOf(result)).toContain('| old-accounting |');
  });

  it('applies an explicit limit after all other filters and has no implicit limit', async () => {
    vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockResolvedValue(transactions);

    const unlimited = await handler({ accountId: 'acc-1', categoryName: '💵 Księgowość' });
    const limited = await handler({ accountId: 'acc-1', categoryName: '💵 Księgowość', limit: 1 });

    expect(textOf(unlimited)).toContain('Matching Transactions: 2/3');
    expect(textOf(limited)).toContain('Matching Transactions: 1/3');
  });

  it('rejects a non-positive limit instead of silently treating it as unlimited', async () => {
    const fetch = vi.spyOn(GetTransactionsDataFetcher.prototype, 'fetch').mockResolvedValue(transactions);

    const result = await handler({ accountId: 'acc-1', limit: 0 } as never);

    expect(textOf(result)).toContain('positive integer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('documents unbounded omitted dates and limit in the MCP schema', () => {
    const inputSchema = schema.inputSchema as {
      properties?: Record<string, { description?: string }>;
    };

    expect(inputSchema.properties?.startDate?.description).toContain('If omitted, no lower date bound');
    expect(inputSchema.properties?.endDate?.description).toContain('If omitted, no upper date bound');
    expect(inputSchema.properties?.limit?.description).toContain('If omitted, return all matching transactions');
  });
});

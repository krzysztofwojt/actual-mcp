import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/data/fetch-accounts.js', () => ({ fetchAllAccounts: vi.fn() }));
vi.mock('../../core/data/fetch-categories.js', () => ({ fetchAllCategories: vi.fn() }));
vi.mock('../../core/data/fetch-transactions.js', () => ({
  fetchAllOnBudgetTransactions: vi.fn(),
  fetchTransactionsForAccount: vi.fn(),
}));

import { fetchAllAccounts } from '../../core/data/fetch-accounts.js';
import { fetchAllCategories } from '../../core/data/fetch-categories.js';
import { fetchAllOnBudgetTransactions, fetchTransactionsForAccount } from '../../core/data/fetch-transactions.js';
import { MonthlySummaryDataFetcher } from './data-fetcher.js';

describe('MonthlySummaryDataFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllAccounts).mockResolvedValue([{ id: 'acc-1', name: 'Checking' }]);
    vi.mocked(fetchAllCategories).mockResolvedValue([]);
    vi.mocked(fetchAllOnBudgetTransactions).mockResolvedValue([]);
    vi.mocked(fetchTransactionsForAccount).mockResolvedValue([]);
  });

  it('rejects an unknown explicit account instead of broadening the report', async () => {
    await expect(new MonthlySummaryDataFetcher().fetchAll('missing', '2026-01-01', '2026-03-31')).rejects.toThrow(
      'ACCOUNT_NOT_FOUND'
    );
    expect(fetchTransactionsForAccount).not.toHaveBeenCalled();
  });
});

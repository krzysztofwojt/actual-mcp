import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/data/fetch-accounts.js', () => ({ fetchAllAccounts: vi.fn() }));
vi.mock('../../core/data/fetch-categories.js', () => ({
  fetchAllCategories: vi.fn(),
  fetchAllCategoryGroups: vi.fn(),
}));
vi.mock('../../core/data/fetch-transactions.js', () => ({
  fetchAllOnBudgetTransactions: vi.fn(),
  fetchTransactionsForAccount: vi.fn(),
}));

import { fetchAllAccounts } from '../../core/data/fetch-accounts.js';
import { fetchAllCategories, fetchAllCategoryGroups } from '../../core/data/fetch-categories.js';
import { fetchAllOnBudgetTransactions, fetchTransactionsForAccount } from '../../core/data/fetch-transactions.js';
import { SpendingByCategoryDataFetcher } from './data-fetcher.js';

describe('SpendingByCategoryDataFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllAccounts).mockResolvedValue([{ id: 'acc-1', name: 'Checking' }]);
    vi.mocked(fetchAllCategories).mockResolvedValue([]);
    vi.mocked(fetchAllCategoryGroups).mockResolvedValue([]);
    vi.mocked(fetchAllOnBudgetTransactions).mockResolvedValue([]);
    vi.mocked(fetchTransactionsForAccount).mockResolvedValue([]);
  });

  it('passes omitted date bounds through for an all-account report', async () => {
    await new SpendingByCategoryDataFetcher().fetchAll(undefined, undefined, undefined);
    expect(fetchAllOnBudgetTransactions).toHaveBeenCalledWith(expect.any(Array), undefined, undefined);
  });

  it('rejects an unknown explicit account', async () => {
    await expect(new SpendingByCategoryDataFetcher().fetchAll('missing', undefined, undefined)).rejects.toThrow(
      'ACCOUNT_NOT_FOUND'
    );
    expect(fetchTransactionsForAccount).not.toHaveBeenCalled();
  });
});

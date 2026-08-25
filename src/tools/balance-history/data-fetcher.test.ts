import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/data/fetch-accounts.js', () => ({ fetchAllAccounts: vi.fn() }));
vi.mock('../../core/data/fetch-transactions.js', () => ({
  fetchAllTransactions: vi.fn(),
  fetchTransactionsForAccount: vi.fn(),
}));
vi.mock('../../core/data/account-balance.js', () => ({ fetchCurrentAccountBalance: vi.fn() }));

import { fetchAllAccounts } from '../../core/data/fetch-accounts.js';
import { fetchCurrentAccountBalance } from '../../core/data/account-balance.js';
import { fetchAllTransactions, fetchTransactionsForAccount } from '../../core/data/fetch-transactions.js';
import { BalanceHistoryDataFetcher } from './data-fetcher.js';

const accounts = [
  { id: 'on', name: 'On budget', offbudget: false, closed: false },
  { id: 'off', name: 'Off budget', offbudget: true, closed: false },
  { id: 'closed', name: 'Closed', offbudget: false, closed: true },
];

describe('BalanceHistoryDataFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllAccounts).mockResolvedValue(accounts.map((account) => ({ ...account })));
    vi.mocked(fetchAllTransactions).mockResolvedValue([]);
    vi.mocked(fetchTransactionsForAccount).mockResolvedValue([]);
    vi.mocked(fetchCurrentAccountBalance).mockResolvedValue(0);
  });

  it('aggregates only open on-budget accounts by default', async () => {
    const result = await new BalanceHistoryDataFetcher().fetchAll(undefined, false, '2026-01-01', '2026-03-31');

    expect(fetchAllTransactions).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'on' })],
      '2026-01-01',
      '2026-03-31'
    );
    expect(result.accounts.map((account) => account.id)).toEqual(['on']);
  });

  it('includes open off-budget accounts only when requested', async () => {
    const result = await new BalanceHistoryDataFetcher().fetchAll(undefined, true, '2026-01-01', '2026-03-31');

    expect(result.accounts.map((account) => account.id)).toEqual(['on', 'off']);
    expect(fetchAllTransactions).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'on' }), expect.objectContaining({ id: 'off' })],
      '2026-01-01',
      '2026-03-31'
    );
  });

  it('allows an explicitly selected off-budget account', async () => {
    const result = await new BalanceHistoryDataFetcher().fetchAll('off', false, '2026-01-01', '2026-03-31');

    expect(result.account?.id).toBe('off');
    expect(fetchTransactionsForAccount).toHaveBeenCalledWith('off', '2026-01-01', '2026-03-31');
  });

  it('rejects an unknown explicit account without falling back to all accounts', async () => {
    await expect(
      new BalanceHistoryDataFetcher().fetchAll('missing', false, '2026-01-01', '2026-03-31')
    ).rejects.toThrow('ACCOUNT_NOT_FOUND');
    expect(fetchAllTransactions).not.toHaveBeenCalled();
    expect(fetchTransactionsForAccount).not.toHaveBeenCalled();
  });
});

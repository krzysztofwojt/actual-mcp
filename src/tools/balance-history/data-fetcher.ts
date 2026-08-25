// Fetches accounts, transactions, and balances for balance-history tool
import { fetchAllAccounts } from '../../core/data/fetch-accounts.js';
import { fetchAllTransactions, fetchTransactionsForAccount } from '../../core/data/fetch-transactions.js';
import type { Account, Transaction } from '../../core/types/domain.js';
import { fetchCurrentAccountBalance } from '../../core/data/account-balance.js';

export class BalanceHistoryDataFetcher {
  async fetchAll(
    accountId: string | undefined,
    includeOffBudget: boolean,
    start: string,
    end: string
  ): Promise<{
    account: Account | undefined;
    accounts: Account[];
    transactions: Transaction[];
  }> {
    const accounts = await fetchAllAccounts();
    const account = accountId ? accounts.find((a) => a.id === accountId) : undefined;

    if (accountId && !account) {
      throw new Error(`ACCOUNT_NOT_FOUND: ${accountId}`);
    }

    let transactions: Transaction[] = [];
    let selectedAccounts: Account[];
    if (account) {
      transactions = await fetchTransactionsForAccount(account.id, start, end);
      account.balance = await fetchCurrentAccountBalance(account.id);
      selectedAccounts = [account];
    } else {
      selectedAccounts = accounts.filter(
        (candidate) => !candidate.closed && (includeOffBudget || !candidate.offbudget)
      );
      transactions = await fetchAllTransactions(selectedAccounts, start, end);
      for (const a of selectedAccounts) {
        a.balance = await fetchCurrentAccountBalance(a.id);
      }
    }

    return { account, accounts: selectedAccounts, transactions };
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountWriteTools } from './index.js';

vi.mock('../../actual-api.js', () => ({ getAccounts: vi.fn(), getCategories: vi.fn(), createTransaction: vi.fn() }));
vi.mock('../../domain/account-api.js', () => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  closeAccount: vi.fn(),
  reopenAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountBalance: vi.fn(),
}));

import { createTransaction, getAccounts } from '../../actual-api.js';
import * as accountApi from '../../domain/account-api.js';

function handler(name: string): (typeof accountWriteTools)[number]['handler'] {
  return accountWriteTools.find((tool) => tool.schema.name === name)!.handler;
}

describe('account tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers the complete account mutation lifecycle', () => {
    expect(accountWriteTools.map((tool) => tool.schema.name)).toEqual([
      'create-account',
      'update-account',
      'close-account',
      'reopen-account',
      'delete-account',
      'reconcile-account',
    ]);
  });

  it('creates an account using exact decimal minor-unit conversion and verifies it', async () => {
    vi.mocked(getAccounts)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'a1', name: 'Savings', offbudget: false }]);
    vi.mocked(accountApi.createAccount).mockResolvedValue('a1');
    const result = await handler('create-account')({
      name: 'Savings',
      offBudget: false,
      initialBalance: '12.34',
    } as never);
    expect(accountApi.createAccount).toHaveBeenCalledWith({ name: 'Savings', offbudget: false, closed: false }, 1234);
    expect(result.isError).toBeUndefined();
  });

  it('reconciles by creating one explicit cleared adjustment and checking the final balance', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ id: 'a1', name: 'Checking' }]);
    vi.mocked(accountApi.getAccountBalance).mockResolvedValueOnce(1000).mockResolvedValueOnce(1250);
    vi.mocked(createTransaction).mockResolvedValue('t1');
    const result = await handler('reconcile-account')({
      account: 'checking',
      targetBalance: '12.50',
      date: '2026-08-24',
    } as never);
    expect(createTransaction).toHaveBeenCalledWith('a1', expect.objectContaining({ amount: '2.50', cleared: true }));
    expect(result.isError).toBeUndefined();
  });

  it('fails when reconciliation readback differs from the target', async () => {
    vi.mocked(getAccounts).mockResolvedValue([{ id: 'a1', name: 'Checking' }]);
    vi.mocked(accountApi.getAccountBalance).mockResolvedValueOnce(1000).mockResolvedValueOnce(1249);
    vi.mocked(createTransaction).mockResolvedValue('t1');
    const result = await handler('reconcile-account')({
      account: 'a1',
      targetBalance: '12.50',
      date: '2026-08-24',
    } as never);
    expect(result.isError).toBe(true);
  });
});

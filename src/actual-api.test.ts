import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(),
  getBudgets: vi.fn(),
  downloadBudget: vi.fn(),
  sync: vi.fn(),
  shutdown: vi.fn(),
  getAccounts: vi.fn(),
  getTransactions: vi.fn(),
  q: vi.fn(),
  aqlQuery: vi.fn(),
  addTransactions: vi.fn(),
  updateTransaction: vi.fn(),
  getAccountBalance: vi.fn(),
}));

import * as api from '@actual-app/api';
import { createTransaction, updateTransaction, getAccounts, getAccountBalance, getReports, initActualApi, shutdownActualApi } from './actual-api.js';
import { getActualConnection, resetActualConnectionForTests } from './integrations/actual/connection.js';

describe('initActualApi syncing', () => {
  beforeEach(async () => {
    resetActualConnectionForTests();
    vi.clearAllMocks();
    vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'budget-1', cloudFileId: 'cloud-1' }] as never);
    vi.mocked(api.sync).mockResolvedValue(undefined as never);
    process.env.ACTUAL_SERVER_URL = 'https://example.invalid';
    process.env.ACTUAL_PASSWORD = 'secret';
    delete process.env.ACTUAL_SYNC_TTL_MS;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await shutdownActualApi();
  });

  it('downloads the budget once and does not sync on the first call', async () => {
    await initActualApi();

    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
    expect(api.sync).not.toHaveBeenCalled();
  });

  it('does not re-download the budget on later calls', async () => {
    await initActualApi();
    vi.advanceTimersByTime(120_000);
    await initActualApi();

    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
  });

  it('syncs on every later call by default', async () => {
    await initActualApi();
    await initActualApi();
    await initActualApi();
    expect(api.sync).toHaveBeenCalledTimes(2);
  });

  it('honours ACTUAL_SYNC_TTL_MS', async () => {
    process.env.ACTUAL_SYNC_TTL_MS = '0';
    await initActualApi();

    await initActualApi();
    await initActualApi();
    expect(api.sync).toHaveBeenCalledTimes(2);
  });

  it('never syncs when ACTUAL_SYNC_TTL_MS is negative', async () => {
    process.env.ACTUAL_SYNC_TTL_MS = '-1';
    await initActualApi();

    vi.advanceTimersByTime(600_000);
    await initActualApi();
    expect(api.sync).not.toHaveBeenCalled();
  });

  it('fails closed when a sync fails', async () => {
    await initActualApi();
    vi.mocked(api.sync).mockRejectedValueOnce(new Error('server unreachable'));
    await expect(initActualApi()).rejects.toThrow('server unreachable');
  });

  it('converts exact decimal amounts and verifies a newly created transaction', async () => {
    vi.mocked(api.getTransactions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'txn-1', amount: 1234 }] as never);
    vi.mocked(api.addTransactions).mockResolvedValue('ok');

    await expect(createTransaction('account-1', { date: '2026-08-24', amount: '12.34' })).resolves.toBe('txn-1');
    expect(api.addTransactions).toHaveBeenCalledWith(
      'account-1',
      [{ date: '2026-08-24', amount: 1234, subtransactions: undefined }],
      { runTransfers: true }
    );
  });

  it('fails an update when Actual does not return the updated transaction', async () => {
    vi.mocked(api.updateTransaction).mockResolvedValue([]);
    await expect(updateTransaction('txn-1', { amount: '12.34' })).rejects.toThrow(
      'TRANSACTION_UPDATE_READBACK_MISMATCH'
    );
  });

  it('reads the transaction back when Actual returns undefined after a partial update', async () => {
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.updateTransaction).mockResolvedValue(undefined as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({
      data: [{ id: 'txn-1', category: 'category-2' }],
    });

    await expect(updateTransaction('txn-1', { category: 'category-2' })).resolves.toMatchObject([
      { id: 'txn-1', category: 'category-2' },
    ]);
  });
});

describe('actual-api wrappers delegate through the connection', () => {
  beforeEach(() => {
    resetActualConnectionForTests();
    vi.clearAllMocks();
    vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'budget-1', cloudFileId: 'cloud-1' }] as never);
    vi.mocked(api.sync).mockResolvedValue(undefined as never);
    process.env.ACTUAL_SERVER_URL = 'https://example.invalid';
    process.env.ACTUAL_PASSWORD = 'secret';
    delete process.env.ACTUAL_SYNC_TTL_MS;
  });

  afterEach(() => resetActualConnectionForTests());

  it('getAccounts ensures init then calls api.getAccounts once', async () => {
    vi.mocked(api.getAccounts).mockResolvedValue([{ id: 'a1', name: 'Checking' }] as never);

    const result = await getAccounts();

    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.getAccounts).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 'a1', name: 'Checking' }]);
  });

  it('getAccountBalance passes accountId and cutoff through to api', async () => {
    vi.mocked(api.getAccountBalance).mockResolvedValue(12345 as never);
    const cutoff = new Date('2026-02-28');

    const balance = await getAccountBalance('a1', cutoff);

    expect(api.getAccountBalance).toHaveBeenCalledWith('a1', cutoff);
    expect(balance).toBe(12345);
  });

  it('getReports uses the initialized handle in one queued operation', async () => {
    const send = vi.fn().mockResolvedValue([{ id: 'report-1' }]);
    vi.mocked(api.init).mockResolvedValue({ send } as never);
    const run = vi.spyOn(getActualConnection(), 'run');

    await expect(getReports()).resolves.toEqual([{ id: 'report-1' }]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('report/get', undefined);
  });
});

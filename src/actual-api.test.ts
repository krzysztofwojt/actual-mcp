import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(),
  getBudgets: vi.fn(),
  downloadBudget: vi.fn(),
  sync: vi.fn(),
  shutdown: vi.fn(),
  getTransactions: vi.fn(),
  addTransactions: vi.fn(),
  updateTransaction: vi.fn(),
}));

import * as api from '@actual-app/api';
import { createTransaction, initActualApi, shutdownActualApi, updateTransaction } from './actual-api.js';

describe('initActualApi syncing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'budget-1', cloudFileId: 'cloud-1' }] as never);
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
});

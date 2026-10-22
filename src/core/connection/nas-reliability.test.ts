import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('@actual-app/api', () => ({ sync: vi.fn(), downloadBudget: vi.fn(), shutdown: vi.fn(), init: vi.fn() }));
import * as api from '@actual-app/api';
import { retrySync, downloadBudgetWithRetry, isRetryableActualNetworkError } from './nas-reliability.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
it('coalesces concurrent sync calls', async () => {
  let finish!: () => void;
  vi.mocked(api.sync).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const a = retrySync();
  const b = retrySync();
  finish();
  await Promise.all([a, b]);
  expect(api.sync).toHaveBeenCalledTimes(1);
});
it('retries a network failure and resets the failed download session', async () => {
  vi.mocked(api.downloadBudget).mockRejectedValueOnce(new Error('network-failure'));
  const result = downloadBudgetWithRetry({ dataDir: '/tmp/unused-mock' }, 'budget', undefined);
  await vi.runAllTimersAsync();
  await result;
  expect(api.downloadBudget).toHaveBeenCalledTimes(2);
  expect(api.shutdown).toHaveBeenCalledTimes(1);
  expect(api.init).toHaveBeenCalledTimes(1);
});
it('propagates non-network sync failures without retry', async () => {
  vi.mocked(api.sync).mockRejectedValueOnce(new Error('invalid budget'));
  await expect(retrySync()).rejects.toThrow('invalid budget');
  expect(api.sync).toHaveBeenCalledTimes(1);
  expect(isRetryableActualNetworkError(null)).toBe(false);
});

import { afterEach, expect, it, vi } from 'vitest';
import { warmActualApiUntilReady } from './actual-warmup.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('finishes immediately after successful initialization', async () => {
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const initialize = vi.fn().mockResolvedValue(undefined);
  await warmActualApiUntilReady(initialize);
  expect(initialize).toHaveBeenCalledTimes(1);
});
it('waits fifteen seconds before restarting a failed network initialization cycle', async () => {
  vi.useFakeTimers();
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const initialize = vi.fn().mockRejectedValueOnce({ code: 'network-failure' }).mockResolvedValue(undefined);
  const warmup = warmActualApiUntilReady(initialize);
  await vi.advanceTimersByTimeAsync(14999);
  expect(initialize).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await warmup;
  expect(initialize).toHaveBeenCalledTimes(2);
});
it('stops on authentication rejection without repeatedly submitting credentials', async () => {
  vi.useFakeTimers();
  const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const initialize = vi.fn().mockRejectedValue({ code: 'unauthorized', message: 'private details' });
  await warmActualApiUntilReady(initialize);
  await vi.runAllTimersAsync();
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls)).not.toContain('private details');
});

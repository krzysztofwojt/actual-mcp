import { afterEach, expect, it, vi } from 'vitest';
import { actualNetworkErrorCode, retryActualOperation } from './reliability.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('logs one redacted line per failed attempt and a recovery summary', async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const failure = new TypeError('sensitive payload', {
    cause: Object.assign(new Error('private host'), { code: 'UND_ERR_SOCKET' }),
  });
  const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue('done');
  const promise = retryActualOperation('sync', run);
  await vi.runAllTimersAsync();
  expect(await promise).toBe('done');
  expect(run.mock.calls).toEqual([[1], [2]]);
  expect(log).toHaveBeenCalledTimes(2);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
    operation: 'sync',
    attempt: 1,
    code: 'UND_ERR_SOCKET',
    freshConnection: false,
    retry: true,
  });
  expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({ event: 'actual-retry-succeeded', attempts: 2 });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/sensitive|private host|stack/);
});
it('stops after the configured bound and preserves the original error', async () => {
  vi.useFakeTimers();
  vi.stubEnv('ACTUAL_HTTP_RETRY_ATTEMPTS', '2');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const failure = Object.assign(new Error('offline'), { code: 'network-failure' });
  const run = vi.fn().mockRejectedValue(failure);
  const assertion = expect(retryActualOperation('login', run)).rejects.toBe(failure);
  await vi.runAllTimersAsync();
  await assertion;
  expect(run).toHaveBeenCalledTimes(2);
});
it('never retries credentials, TLS, rate limit, cancellation, or vague error messages', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const failure of [
    Object.assign(new Error('network timeout'), { code: 'unauthorized' }),
    { code: 'network-failure', cause: { code: 'CERT_HAS_EXPIRED' } },
    { code: 'RATE_LIMIT_EXCEEDED' },
    new DOMException('aborted', 'AbortError'),
    new Error('socket network fetch temporarily unavailable'),
  ]) {
    expect(actualNetworkErrorCode(failure)).toBeUndefined();
    const run = vi.fn().mockRejectedValue(failure);
    await expect(retryActualOperation('download', run)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
  }
});
it('handles exact SDK codes and cyclic or primitive errors safely', () => {
  const cyclic = { cause: undefined as unknown };
  cyclic.cause = cyclic;
  expect(actualNetworkErrorCode(cyclic)).toBeUndefined();
  expect(actualNetworkErrorCode('network-failure')).toBeUndefined();
  expect(actualNetworkErrorCode(new Error('Authentication failed: network-failure'))).toBe('network-failure');
  expect(actualNetworkErrorCode({ reason: 'network-failure', cause: { code: 'ECONNRESET' } })).toBe('ECONNRESET');
});

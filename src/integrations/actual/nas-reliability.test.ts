import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '@actual-app/api';
import { ActualConnection } from './connection.js';
import { retryNetwork } from './reliability.js';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(),
  getBudgets: vi.fn(),
  downloadBudget: vi.fn(),
  sync: vi.fn(),
  shutdown: vi.fn(),
}));
let dataDir: string;
beforeEach(() => {
  vi.resetAllMocks();
  dataDir = mkdtempSync(join(tmpdir(), 'actual-upgrade-test-'));
  vi.stubEnv('ACTUAL_DATA_DIR', dataDir);
  vi.stubEnv('ACTUAL_BUDGET_SYNC_ID', 'cloud-1');
  vi.stubEnv('ACTUAL_SYNC_TTL_MS', '0');
  vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'local-1' }] as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('NAS reliability source ports', () => {
  it('shares one forced sync across nested reads, and refreshes again next request', async () => {
    const connection = new ActualConnection();
    const read = (): Promise<void> =>
      connection.withSyncedRead(async () => {
        await connection.run(async () => 1);
        await connection.withSyncedRead(() => connection.run(async () => 2));
      });
    await read();
    expect(api.sync).toHaveBeenCalledTimes(1);
    await read();
    expect(api.sync).toHaveBeenCalledTimes(2);
    expect(api.init).toHaveBeenCalledTimes(1);
  });

  it('clears readiness and blocks stale answers after failed refresh, then recovers', async () => {
    const connection = new ActualConnection();
    await connection.ensureReady();
    const marker = join(dataDir, '.actual-mcp-ready');
    expect(existsSync(marker)).toBe(true);
    vi.mocked(api.sync).mockRejectedValueOnce(new Error('invalid auth'));
    const operation = vi.fn();
    await expect(connection.withSyncedRead(operation)).rejects.toThrow('invalid auth');
    expect(operation).not.toHaveBeenCalled();
    expect(connection.isReady()).toBe(false);
    expect(existsSync(marker)).toBe(false);
    await connection.withSyncedRead(async () => 1);
    expect(connection.isReady()).toBe(true);
    expect(existsSync(marker)).toBe(true);
    await connection.drainAndClose();
    expect(existsSync(marker)).toBe(false);
  });

  it('retries sync transport failures three times with bounded backoff', async () => {
    vi.useFakeTimers();
    vi.mocked(api.sync).mockRejectedValue(new Error('network-failure'));
    const connection = new ActualConnection();
    const result = expect(connection.sync()).rejects.toThrow('network-failure');
    await vi.runAllTimersAsync();
    await result;
    expect(api.sync).toHaveBeenCalledTimes(3);
    expect(connection.isReady()).toBe(false);
  });

  it('reopens SDK handles before retrying a failed budget download', async () => {
    vi.useFakeTimers();
    vi.mocked(api.downloadBudget).mockRejectedValueOnce(new Error('network-failure'));
    const connection = new ActualConnection();
    const result = connection.ensureReady();
    await vi.runAllTimersAsync();
    await result;
    expect(api.downloadBudget).toHaveBeenCalledTimes(2);
    expect(api.init).toHaveBeenCalledTimes(2);
    expect(api.shutdown).toHaveBeenCalledTimes(1);
    expect(connection.isReady()).toBe(true);
  });

  it('does not retry validation failures', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('invalid data'));
    await expect(retryNetwork(operation)).rejects.toThrow('invalid data');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous unconfigured budgets, accepts explicit sync ID even without listing', async () => {
    vi.stubEnv('ACTUAL_BUDGET_SYNC_ID', '');
    vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'one' }, { id: 'two' }] as never);
    const connection = new ActualConnection();
    await expect(connection.ensureReady()).rejects.toThrow('ACTUAL_BUDGET_SYNC_ID_REQUIRED');
    vi.stubEnv('ACTUAL_BUDGET_SYNC_ID', 'explicit-cloud-id');
    vi.mocked(api.getBudgets).mockResolvedValue([]);
    await connection.ensureReady();
    expect(api.downloadBudget).toHaveBeenCalledWith('explicit-cloud-id', undefined);
  });
});

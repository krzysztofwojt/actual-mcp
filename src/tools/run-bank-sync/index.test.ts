import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler, schema } from './index.js';

vi.mock('../../actual-api.js', () => ({
  getAccounts: vi.fn(),
}));
vi.mock('../../core/runtime/bank-sync-jobs.js', () => ({
  startBankSyncJob: vi.fn(),
}));

import { getAccounts } from '../../actual-api.js';
import { startBankSyncJob } from '../../core/runtime/bank-sync-jobs.js';

const job = {
  id: '03a65335-a12a-4309-a7ea-b38e294213ac',
  scope: 'all',
  status: 'queued',
  createdAt: '2026-08-24T00:00:00Z',
} as const;

describe('run-bank-sync tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startBankSyncJob).mockReturnValue(job);
    vi.mocked(getAccounts).mockResolvedValue([{ id: 'acc-123', name: 'Checking' }]);
  });

  it('publishes the asynchronous job contract', () => {
    expect(schema.name).toBe('run-bank-sync');
    expect(schema.description).toContain('job ID');
    expect(schema.inputSchema.type).toBe('object');
  });

  it('rejects an omitted scope without queueing a broad sync', async () => {
    const result = await handler({} as never);
    expect(result.isError).toBe(true);
    expect(startBankSyncJob).not.toHaveBeenCalled();
  });

  it.each(['onbudget', 'offbudget'] as const)('queues the %s scope', async (scope) => {
    await handler({ scope });
    expect(startBankSyncJob).toHaveBeenCalledWith(scope);
  });

  it('resolves a specific account by exact case-insensitive name', async () => {
    await handler({ scope: 'account', account: 'checking' });
    expect(startBankSyncJob).toHaveBeenCalledWith('acc-123');
  });

  it('rejects account scope without an account', async () => {
    const result = await handler({ scope: 'account' });
    expect(result.isError).toBe(true);
    expect(startBankSyncJob).not.toHaveBeenCalled();
  });

  it('rejects account outside account scope', async () => {
    const result = await handler({ scope: 'all', account: 'Checking' });
    expect(result.isError).toBe(true);
    expect(startBankSyncJob).not.toHaveBeenCalled();
  });

  it('returns queue errors', async () => {
    vi.mocked(startBankSyncJob).mockImplementation(() => {
      throw new Error('BANK_SYNC_ALREADY_RUNNING');
    });
    const result = await handler({ scope: 'all' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('BANK_SYNC_ALREADY_RUNNING');
  });
});

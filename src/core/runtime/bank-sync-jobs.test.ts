import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../actual-api.js', () => ({ runBankSync: vi.fn(), syncActual: vi.fn() }));
import { runBankSync, syncActual } from '../../actual-api.js';
import { BankSyncJob, getBankSyncJob, startBankSyncJob } from './bank-sync-jobs.js';

let stateDir: string;

async function waitForTerminal(id: string): Promise<BankSyncJob> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = getBankSyncJob(id);
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('job did not finish');
}

describe('bank sync jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-bank-jobs-'));
    process.env.ACTUAL_MCP_STATE_DIR = stateDir;
    vi.mocked(syncActual).mockResolvedValue(undefined);
    vi.mocked(runBankSync).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.ACTUAL_MCP_STATE_DIR;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists and completes a queued bank sync', async () => {
    const queued = startBankSyncJob('onbudget');
    expect(queued.status).toBe('queued');
    const completed = await waitForTerminal(queued.id);
    expect(completed.status).toBe('completed');
    expect(runBankSync).toHaveBeenCalledWith('onbudget');
    expect(syncActual).toHaveBeenCalledTimes(2);
  });

  it('does not enter bank sync after a failed preparation', async () => {
    vi.mocked(syncActual).mockRejectedValueOnce(new Error('offline'));
    const failed = await waitForTerminal(startBankSyncJob('all').id);
    expect(failed.error).toBe('BANK_SYNC_PREPARATION_FAILED');
    expect(runBankSync).not.toHaveBeenCalled();
  });

  it('does not replay bank sync after failed post-write CRDT synchronization', async () => {
    vi.mocked(syncActual).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const failed = await waitForTerminal(startBankSyncJob('all').id);
    expect(failed.error).toContain('MUTATION_OUTCOME_UNCERTAIN');
    expect(runBankSync).toHaveBeenCalledTimes(1);
  });

  it('persists failures without throwing from the background task', async () => {
    vi.mocked(runBankSync).mockRejectedValue(new Error('bank unavailable'));
    const queued = startBankSyncJob('all');
    const failed = await waitForTerminal(queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('MUTATION_OUTCOME_UNCERTAIN');
    expect(runBankSync).toHaveBeenCalledTimes(1);
  });
});

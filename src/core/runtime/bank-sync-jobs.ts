import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { runBankSync, syncActual } from '../../actual-api.js';
import { appendAuditEvent, operationStateRoot } from './operation-runtime.js';
import { withBudgetLock } from './operation-queue.js';

export type BankSyncScope = 'all' | 'onbudget' | 'offbudget' | string;
export interface BankSyncJob {
  id: string;
  scope: BankSyncScope;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

const activeJobIds = new Set<string>();

function jobsPath(): string {
  return path.join(operationStateRoot(), '.actual-mcp-bank-sync-jobs.json');
}

function readJobs(): BankSyncJob[] {
  try {
    return JSON.parse(fs.readFileSync(jobsPath(), 'utf8')) as BankSyncJob[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function writeJobs(jobs: BankSyncJob[]): void {
  fs.mkdirSync(operationStateRoot(), { recursive: true });
  const target = jobsPath();
  const temporary = `${target}.tmp`;
  const retained = jobs.slice(-100);
  fs.writeFileSync(temporary, JSON.stringify(retained, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function replaceJob(job: BankSyncJob): void {
  const jobs = readJobs().filter((item) => item.id !== job.id);
  writeJobs([...jobs, job]);
}

function recoverInterruptedJobs(): BankSyncJob[] {
  const jobs = readJobs();
  const recovered = jobs.map((job) =>
    (job.status === 'queued' || job.status === 'running') && !activeJobIds.has(job.id)
      ? ({
          ...job,
          status: 'interrupted',
          completedAt: new Date().toISOString(),
          error: 'MCP restarted before the job reached a terminal state',
        } satisfies BankSyncJob)
      : job
  );
  if (recovered.some((job, index) => job.status !== jobs[index]?.status)) writeJobs(recovered);
  return recovered;
}

export function listBankSyncJobs(): BankSyncJob[] {
  return recoverInterruptedJobs();
}

export function getBankSyncJob(id: string): BankSyncJob | undefined {
  return listBankSyncJobs().find((job) => job.id === id);
}

export function startBankSyncJob(scope: BankSyncScope): BankSyncJob {
  const jobs = recoverInterruptedJobs();
  if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
    throw new Error('BANK_SYNC_ALREADY_RUNNING');
  }
  const job: BankSyncJob = { id: randomUUID(), scope, status: 'queued', createdAt: new Date().toISOString() };
  activeJobIds.add(job.id);
  writeJobs([...jobs, job]);
  appendAuditEvent({
    timestamp: job.createdAt,
    operationId: job.id,
    tool: 'bank-sync-execution',
    status: 'queued',
    args: { scope },
  });

  void withBudgetLock(async () => {
    const running: BankSyncJob = { ...job, status: 'running', startedAt: new Date().toISOString() };
    replaceJob(running);
    appendAuditEvent({
      timestamp: running.startedAt!,
      operationId: job.id,
      tool: 'bank-sync-execution',
      status: 'running',
    });
    try {
      await syncActual();
      await runBankSync(scope === 'all' ? undefined : scope);
      await syncActual();
      const completed: BankSyncJob = { ...running, status: 'completed', completedAt: new Date().toISOString() };
      replaceJob(completed);
      activeJobIds.delete(job.id);
      appendAuditEvent({
        timestamp: completed.completedAt!,
        operationId: job.id,
        tool: 'bank-sync-execution',
        status: 'completed',
      });
    } catch (error) {
      const failed: BankSyncJob = {
        ...running,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      replaceJob(failed);
      activeJobIds.delete(job.id);
      appendAuditEvent({
        timestamp: failed.completedAt!,
        operationId: job.id,
        tool: 'bank-sync-execution',
        status: 'failed',
        error: failed.error,
      });
    }
  });
  return job;
}

import { z } from 'zod';
import { getBankSyncJob, listBankSyncJobs } from '../../core/runtime/bank-sync-jobs.js';
import { defineTool } from '../tool-factory.js';

const statusTool = defineTool(
  'get-bank-sync-status',
  'Read one bank sync job or the recent durable bank sync job history.',
  z.object({ jobId: z.string().uuid().optional() }),
  async ({ jobId }) => {
    if (!jobId) return { jobs: listBankSyncJobs() };
    const job = getBankSyncJob(jobId);
    if (!job) throw new Error(`UNKNOWN_BANK_SYNC_JOB: ${jobId}`);
    return { job };
  }
);

export const schema = statusTool.schema;
export const handler = statusTool.handler;

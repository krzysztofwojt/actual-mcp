import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toJSONSchema, z } from 'zod';
import { getAccounts } from '../../actual-api.js';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import { startBankSyncJob } from '../../core/runtime/bank-sync-jobs.js';
import type { ToolInput } from '../../types.js';
import { errorFromCatch, successWithJson } from '../../utils/response.js';

const RunBankSyncArgsSchema = z.object({
  scope: z.enum(['all', 'onbudget', 'offbudget', 'account']).default('all'),
  account: z
    .string()
    .min(1)
    .optional()
    .describe('Exact account ID or unique account name; required when scope is account'),
});

export const schema = {
  name: 'run-bank-sync',
  description: 'Queue a real GoCardless/SimpleFIN bank sync. Returns immediately with a durable job ID.',
  inputSchema: toJSONSchema(RunBankSyncArgsSchema) as ToolInput,
};

export async function handler(args: z.input<typeof RunBankSyncArgsSchema>): Promise<CallToolResult> {
  try {
    const { scope, account } = RunBankSyncArgsSchema.parse(args);
    if (scope === 'account' && !account) throw new Error('BANK_SYNC_ACCOUNT_REQUIRED');
    if (scope !== 'account' && account) throw new Error('BANK_SYNC_ACCOUNT_ONLY_WITH_ACCOUNT_SCOPE');
    const target =
      scope === 'account' ? resolveEntity(account!, await getAccounts(), (item) => item.name, 'account').id : scope;
    return successWithJson({ job: startBankSyncJob(target) });
  } catch (error) {
    return errorFromCatch(error);
  }
}

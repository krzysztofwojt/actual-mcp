// ----------------------------
// CREATE PAYEE TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { createPayee, getAccounts, getPayees } from '../../../actual-api.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'create-payee',
  description: 'Create a new payee',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the payee',
      },
      transferAccount: {
        type: 'string',
        description: 'Exact transfer account ID or unique account name. Only for transfer payees.',
      },
    },
    required: ['name'],
  },
};

export async function handler(
  args: Record<string, unknown>
): Promise<ReturnType<typeof successWithJson> | ReturnType<typeof errorFromCatch>> {
  try {
    if (!args.name || typeof args.name !== 'string') {
      return errorFromCatch('name is required and must be a string');
    }

    const data: Record<string, unknown> = { name: args.name };
    if (args.transferAccount) {
      if (typeof args.transferAccount !== 'string') return errorFromCatch('transferAccount must be a string');
      data.transfer_acct = resolveEntity(args.transferAccount, await getAccounts(), (item) => item.name, 'account').id;
    }

    const id: string = await createPayee(data);
    const created = (await getPayees()).find((item) => item.id === id);
    if (!created) throw new Error(`PAYEE_READBACK_MISSING: ${id}`);

    return successWithJson({ payee: created });
  } catch (err) {
    return errorFromCatch(err);
  }
}

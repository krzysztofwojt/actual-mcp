// ----------------------------
// UPDATE PAYEE TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { getAccounts, getPayees, updatePayee } from '../../../actual-api.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'update-payee',
  description: 'Update a payee',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Exact payee ID or unique case-insensitive name.',
      },
      name: {
        type: 'string',
        description: 'New name for the payee',
      },
      transferAccount: {
        type: 'string',
        description: 'Exact transfer account ID or unique account name.',
      },
    },
    required: ['id'],
  },
};

export async function handler(
  args: Record<string, unknown>
): Promise<ReturnType<typeof successWithJson> | ReturnType<typeof errorFromCatch>> {
  try {
    if (!args.id || typeof args.id !== 'string') {
      return errorFromCatch('id is required and must be a string');
    }

    const current = resolveEntity(args.id, await getPayees(), (item) => item.name, 'payee');
    const data: Record<string, unknown> = {};
    if (args.name) {
      data.name = args.name;
    }
    if (args.transferAccount) {
      if (typeof args.transferAccount !== 'string') return errorFromCatch('transferAccount must be a string');
      data.transfer_acct = resolveEntity(args.transferAccount, await getAccounts(), (item) => item.name, 'account').id;
    }

    await updatePayee(current.id, data);
    const updated = (await getPayees()).find((item) => item.id === current.id);
    if (!updated) throw new Error(`PAYEE_READBACK_MISSING: ${current.id}`);

    return successWithJson({ payee: updated });
  } catch (err) {
    return errorFromCatch(err);
  }
}

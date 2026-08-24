// ----------------------------
// DELETE PAYEE TOOL
// ----------------------------

import { deletePayee, getPayees } from '../../../actual-api.js';
import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'delete-payee',
  description: 'Delete a payee',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Exact payee ID or unique case-insensitive name.',
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
    await deletePayee(current.id);
    if ((await getPayees()).some((item) => item.id === current.id)) {
      throw new Error(`PAYEE_DELETE_READBACK_MISMATCH: ${current.id}`);
    }

    return successWithJson({ deletedPayeeId: current.id, deletedPayeeName: current.name });
  } catch (err) {
    return errorFromCatch(err);
  }
}

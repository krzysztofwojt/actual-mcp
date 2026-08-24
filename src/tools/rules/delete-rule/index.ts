// ----------------------------
// DELETE RULE TOOL
// ----------------------------

import { deleteRule, getRules } from '../../../actual-api.js';
import { successWithJson, errorFromCatch } from '../../../utils/response.js';

export const schema = {
  name: 'delete-rule',
  description: 'Delete a rule',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'ID of the rule. Should be in UUID format.',
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

    await deleteRule(args.id);
    if ((await getRules()).some((item) => item.id === args.id)) {
      throw new Error(`RULE_DELETE_READBACK_MISMATCH: ${args.id}`);
    }

    return successWithJson('Successfully deleted rule ' + args.id);
  } catch (err) {
    return errorFromCatch(err);
  }
}

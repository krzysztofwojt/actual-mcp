// ----------------------------
// CREATE RULE TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { createRule, getRules } from '../../../actual-api.js';
import { RuleInputSchema } from '../input-schema.js';
import { RuleEntity } from '@actual-app/core/types/models';

export const schema = {
  name: 'create-rule',
  description: 'Create a new rule',
  inputSchema: RuleInputSchema,
};

export async function handler(
  args: Record<string, unknown>
): Promise<ReturnType<typeof successWithJson> | ReturnType<typeof errorFromCatch>> {
  try {
    const { id }: RuleEntity = await createRule(args);
    const created = (await getRules()).find((item) => item.id === id);
    if (!created) throw new Error(`RULE_READBACK_MISSING: ${id}`);

    return successWithJson({ rule: created });
  } catch (err) {
    return errorFromCatch(err);
  }
}

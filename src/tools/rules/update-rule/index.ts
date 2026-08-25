// ----------------------------
// UPDATE RULE TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { getRules, updateRule } from '../../../actual-api.js';
import { UpdateRuleArgsSchema } from '../input-schema.js';
import { toJSONSchema } from 'zod';
import type { ToolInput } from '../../../types.js';
import { normalizeRuleStage } from '../normalize-stage.js';

export const schema = {
  name: 'update-rule',
  description: 'Update a rule',
  inputSchema: toJSONSchema(UpdateRuleArgsSchema) as ToolInput,
};

export async function handler(
  args: Record<string, unknown>
): Promise<ReturnType<typeof successWithJson> | ReturnType<typeof errorFromCatch>> {
  try {
    const input = UpdateRuleArgsSchema.parse(args);
    await updateRule(normalizeRuleStage(input));
    const updated = (await getRules()).find((item) => item.id === input.id);
    if (!updated) throw new Error(`RULE_READBACK_MISSING: ${input.id}`);

    return successWithJson({ rule: updated });
  } catch (err) {
    return errorFromCatch(err);
  }
}

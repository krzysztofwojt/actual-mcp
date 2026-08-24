// ----------------------------
// UPDATE CATEGORY GROUP TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { getCategoryGroups, updateCategoryGroup } from '../../../actual-api.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'update-category-group',
  description: 'Update a category group',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Exact category group ID or unique case-insensitive name.',
      },
      name: {
        type: 'string',
        description: 'New name for the category group',
      },
    },
    required: ['id', 'name'],
  },
};

export async function handler(
  args: Record<string, unknown>
): Promise<ReturnType<typeof successWithJson> | ReturnType<typeof errorFromCatch>> {
  try {
    if (!args.id || typeof args.id !== 'string') {
      return errorFromCatch('id is required and must be a string');
    }

    const current = resolveEntity(args.id, await getCategoryGroups(), (item) => item.name, 'category_group');
    const data: Record<string, unknown> = { name: args.name };

    await updateCategoryGroup(current.id, data);
    const updated = (await getCategoryGroups()).find((item) => item.id === current.id);
    if (!updated) throw new Error(`CATEGORY_GROUP_READBACK_MISSING: ${current.id}`);

    return successWithJson({ categoryGroup: updated });
  } catch (err) {
    return errorFromCatch(err);
  }
}

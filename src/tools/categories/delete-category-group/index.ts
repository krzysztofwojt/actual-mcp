// ----------------------------
// DELETE CATEGORY GROUP TOOL
// ----------------------------

import { deleteCategoryGroup, getCategoryGroups } from '../../../actual-api.js';
import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'delete-category-group',
  description: 'Delete a category group',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Exact category group ID or unique case-insensitive name.',
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

    const current = resolveEntity(args.id, await getCategoryGroups(), (item) => item.name, 'category_group');
    await deleteCategoryGroup(current.id);
    if ((await getCategoryGroups()).some((item) => item.id === current.id)) {
      throw new Error(`CATEGORY_GROUP_DELETE_READBACK_MISMATCH: ${current.id}`);
    }

    return successWithJson({ deletedCategoryGroupId: current.id, deletedCategoryGroupName: current.name });
  } catch (err) {
    return errorFromCatch(err);
  }
}

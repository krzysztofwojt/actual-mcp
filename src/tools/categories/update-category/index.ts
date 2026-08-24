// ----------------------------
// UPDATE CATEGORY TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { getCategories, getCategoryGroups, updateCategory } from '../../../actual-api.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'update-category',
  description: 'Update a category',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Exact category ID or unique case-insensitive name.',
      },
      name: {
        type: 'string',
        description: 'New name for the category. If not changing, repeat.',
      },
      groupId: {
        type: 'string',
        description: 'Exact category group ID or unique group name.',
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

    const current = resolveEntity(args.id, await getCategories(), (item) => item.name, 'category');
    const data: Record<string, unknown> = {};
    if (args.name) {
      data.name = args.name;
    }
    if (args.groupId) {
      if (typeof args.groupId !== 'string') return errorFromCatch('groupId must be a string');
      data.group_id = resolveEntity(args.groupId, await getCategoryGroups(), (item) => item.name, 'category_group').id;
    }

    await updateCategory(current.id, data);
    const updated = (await getCategories()).find((item) => item.id === current.id);
    if (!updated) throw new Error(`CATEGORY_READBACK_MISSING: ${current.id}`);

    return successWithJson({ category: updated });
  } catch (err) {
    return errorFromCatch(err);
  }
}

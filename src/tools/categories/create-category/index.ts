// ----------------------------
// CREATE CATEGORY TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { createCategory, getCategories, getCategoryGroups } from '../../../actual-api.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'create-category',
  description: 'Create a new category',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the category',
      },
      groupId: {
        type: 'string',
        description: 'Exact category group ID or unique case-insensitive name.',
      },
    },
    required: ['name', 'groupId'],
  },
};

export async function handler(
  args: Record<string, unknown>
): Promise<ReturnType<typeof successWithJson> | ReturnType<typeof errorFromCatch>> {
  try {
    if (!args.name || typeof args.name !== 'string') {
      return errorFromCatch('name is required and must be a string');
    }

    if (!args.groupId || typeof args.groupId !== 'string') return errorFromCatch('groupId is required');
    const group = resolveEntity(args.groupId, await getCategoryGroups(), (item) => item.name, 'category_group');
    const data: Record<string, unknown> = {
      name: args.name,
      group_id: group.id,
    };

    const id: string = await createCategory(data);
    const created = (await getCategories()).find((item) => item.id === id);
    if (!created) throw new Error(`CATEGORY_READBACK_MISSING: ${id}`);

    return successWithJson({ category: created });
  } catch (err) {
    return errorFromCatch(err);
  }
}

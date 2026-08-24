// ----------------------------
// CREATE CATEGORY GROUP TOOL
// ----------------------------

import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { createCategoryGroup, getCategoryGroups } from '../../../actual-api.js';

export const schema = {
  name: 'create-category-group',
  description: 'Create a new category group',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the category',
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

    const data: Record<string, unknown> = {
      name: args.name,
    };

    const id: string = await createCategoryGroup(data);
    const created = (await getCategoryGroups()).find((item) => item.id === id);
    if (!created) throw new Error(`CATEGORY_GROUP_READBACK_MISSING: ${id}`);

    return successWithJson({ categoryGroup: created });
  } catch (err) {
    return errorFromCatch(err);
  }
}

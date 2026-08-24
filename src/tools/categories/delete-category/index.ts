// ----------------------------
// DELETE CATEGORY TOOL
// ----------------------------

import { deleteCategory, getCategories } from '../../../actual-api.js';
import { successWithJson, errorFromCatch } from '../../../utils/response.js';
import { resolveEntity } from '../../../core/input/entity-resolver.js';

export const schema = {
  name: 'delete-category',
  description: 'Delete a category',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Exact category ID or unique case-insensitive name.',
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

    const current = resolveEntity(args.id, await getCategories(), (item) => item.name, 'category');
    await deleteCategory(current.id);
    if ((await getCategories()).some((item) => item.id === current.id)) {
      throw new Error(`CATEGORY_DELETE_READBACK_MISMATCH: ${current.id}`);
    }

    return successWithJson({ deletedCategoryId: current.id, deletedCategoryName: current.name });
  } catch (err) {
    return errorFromCatch(err);
  }
}

import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { toJSONSchema, z } from 'zod';
import { errorFromCatch, successWithJson } from '../utils/response.js';

export interface ToolModule {
  schema: Tool;
  handler: (args: never) => Promise<CallToolResult>;
}

export function defineTool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  operation: (args: z.infer<T>) => Promise<unknown>
): ToolModule {
  return {
    schema: { name, description, inputSchema: toJSONSchema(schema) as Tool['inputSchema'] },
    handler: async (raw: never) => {
      try {
        return successWithJson(await operation(schema.parse(raw)));
      } catch (error) {
        return errorFromCatch(error);
      }
    },
  };
}

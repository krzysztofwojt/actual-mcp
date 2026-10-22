import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setupPrompts } from './prompts.js';
import { setupResources } from './resources.js';
import { setupTools } from './tools/index.js';

// Reason: src/ and build/ share the same parent package.json, including in Docker.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

interface CreateServerOptions {
  enableWrite: boolean;
}

/**
 * Creates and configures a new MCP Server instance with all resources, tools, and prompts.
 *
 * @param options - Server configuration options
 * @returns A fully configured Server instance ready to be connected to a transport
 */
export function createServer(options: CreateServerOptions): Server {
  const server = new Server(
    {
      name: 'Actual Budget',
      version,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
        logging: {},
      },
    }
  );

  setupResources(server);
  setupTools(server, options.enableWrite);
  setupPrompts(server);

  server.setRequestHandler(SetLevelRequestSchema, (request) => {
    process.stderr.write(`--- Logging level: ${request.params.level}\n`);
    return {};
  });

  return server;
}

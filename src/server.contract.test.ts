import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from './server.js';

const connections: Array<{ client: Client; server: ReturnType<typeof createServer> }> = [];

async function connect(enableWrite: boolean): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ enableWrite });
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connections.push({ client, server });
  return client;
}

afterEach(async () => {
  await Promise.all(
    connections.splice(0).map(async ({ client, server }) => {
      await client.close();
      await server.close();
    })
  );
});

describe('MCP tool contract', () => {
  it('exposes only read tools when writes are disabled', async () => {
    const client = await connect(false);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
    expect(tools.map((tool) => tool.name)).toContain('get-budget-month');
    expect(tools.map((tool) => tool.name)).toContain('get-bank-sync-status');
    expect(tools.map((tool) => tool.name)).not.toContain('set-budget-amount');
  });

  it('exposes unique schemas and requires operationId on every write tool', async () => {
    const readClient = await connect(false);
    const writeClient = await connect(true);
    const readNames = new Set((await readClient.listTools()).tools.map((tool) => tool.name));
    const tools = (await writeClient.listTools()).tools;
    expect(tools).toHaveLength(53);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools.filter((item) => !readNames.has(item.name))) {
      expect(tool.inputSchema.required, tool.name).toContain('operationId');
      expect(tool.inputSchema.properties, tool.name).toHaveProperty('operationId');
    }
  });

  it('returns an MCP tool error for an unknown tool', async () => {
    const client = await connect(true);
    const result = await client.callTool({ name: 'does-not-exist', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from './server.js';

const connections: Array<{ client: Client; server: ReturnType<typeof createServer> }> = [];

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ enableWrite: false });
  const client = new Client({ name: 'prompt-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connections.push({ client, server });
  return client;
}

afterEach(async () => {
  await Promise.all(
    connections.splice(0).map(async ({ client, server }) => Promise.all([client.close(), server.close()]))
  );
});

describe('MCP prompt contracts', () => {
  it('documents the three-month default for omitted financial-insights dates', async () => {
    const prompts = await (await connect()).listPrompts();
    const financialInsights = prompts.prompts.find((prompt) => prompt.name === 'financial-insights');
    expect(financialInsights?.arguments?.find((argument) => argument.name === 'startDate')?.description).toContain(
      'three months before'
    );
  });

  it('coerces a valid budget-review month argument from the MCP string contract', async () => {
    const result = await (await connect()).getPrompt({ name: 'budget-review', arguments: { months: '6' } });
    expect(result.description).toContain('past 6 months');
  });

  it('rejects a fractional budget-review month count', async () => {
    await expect(
      (await connect()).getPrompt({ name: 'budget-review', arguments: { months: '1.5' } })
    ).rejects.toThrow();
  });
});

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from './server.js';

vi.mock('./resources.js', () => ({
  setupResources: vi.fn(),
}));

vi.mock('./tools/index.js', () => ({
  setupTools: vi.fn(),
}));

vi.mock('./prompts.js', () => ({
  setupPrompts: vi.fn(),
}));

import { setupResources } from './resources.js';
import { setupTools } from './tools/index.js';
import { setupPrompts } from './prompts.js';

describe('createServer', () => {
  it('advertises the package.json version in the initialize response', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const server = createServer({ enableWrite: false });
    const client = new Client({ name: 'version-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(client.getServerVersion()?.version).toBe(pkg.version);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns a configured Server instance', () => {
    const server = createServer({ enableWrite: false });

    expect(server).toBeInstanceOf(Server);
    expect(setupResources).toHaveBeenCalledWith(server);
    expect(setupTools).toHaveBeenCalledWith(server, false);
    expect(setupPrompts).toHaveBeenCalledWith(server);
  });

  it('passes enableWrite: true to setupTools', () => {
    vi.mocked(setupTools).mockClear();
    const server = createServer({ enableWrite: true });

    expect(setupTools).toHaveBeenCalledWith(server, true);
  });

  it('registers all setup handlers for each new instance', () => {
    vi.mocked(setupResources).mockClear();
    vi.mocked(setupTools).mockClear();
    vi.mocked(setupPrompts).mockClear();

    const server1 = createServer({ enableWrite: false });
    const server2 = createServer({ enableWrite: true });

    expect(server1).not.toBe(server2);
    expect(setupResources).toHaveBeenCalledTimes(2);
    expect(setupTools).toHaveBeenCalledTimes(2);
    expect(setupPrompts).toHaveBeenCalledTimes(2);
  });
});

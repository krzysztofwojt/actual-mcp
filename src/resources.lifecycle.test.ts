import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '@actual-app/api';
import { createServer } from './server.js';
import { resetActualConnectionForTests } from './integrations/actual/connection.js';
vi.mock('@actual-app/api', () => ({
  init: vi.fn(),
  shutdown: vi.fn(),
  getBudgets: vi.fn(),
  downloadBudget: vi.fn(),
  sync: vi.fn(),
  getAccounts: vi.fn(),
  getPayees: vi.fn(),
  getAccountBalance: vi.fn(),
  getTransactions: vi.fn(),
}));
const sessions: Array<{ client: Client; server: ReturnType<typeof createServer> }> = [];
let dataDir: string;
async function connect(): Promise<Client> {
  const server = createServer({ enableWrite: false });
  const client = new Client({ name: 'resource-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  sessions.push({ client, server });
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  resetActualConnectionForTests();
  dataDir = mkdtempSync(join(tmpdir(), 'actual-resource-test-'));
  vi.stubEnv('ACTUAL_DATA_DIR', dataDir);
  vi.stubEnv('ACTUAL_BUDGET_SYNC_ID', 'cloud-id');
  vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'local-id' }] as never);
  vi.mocked(api.getAccounts).mockResolvedValue([{ id: 'one', name: 'Test account' }]);
});
afterEach(async () => {
  await Promise.all(
    sessions.splice(0).map(async ({ client, server }) => {
      await client.close();
      await server.close();
    })
  );
  resetActualConnectionForTests();
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});
describe('shared tool/resource budget lifecycle', () => {
  it('queues resources behind active tools without shutting down the shared SDK', async () => {
    const tools = await connect();
    const resources = await connect();
    let release!: (value: never[]) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(api.getPayees).mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const tool = tools.callTool({ name: 'get-payees', arguments: {} });
    await entered;
    const listing = resources.listResources();
    await Promise.resolve();
    expect(api.getAccounts).not.toHaveBeenCalled();
    release([]);
    await tool;
    expect((await listing).resources).toHaveLength(2);
    expect(api.sync).toHaveBeenCalledTimes(2);
    expect(api.shutdown).not.toHaveBeenCalled();
    vi.mocked(api.getAccountBalance).mockResolvedValue(123);
    await resources.readResource({ uri: 'actual://accounts/one' });
    expect(api.sync).toHaveBeenCalledTimes(3);
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.shutdown).not.toHaveBeenCalled();
  });
  it('releases the lock after a failed resource refresh and retries on the next request', async () => {
    const client = await connect();
    vi.mocked(api.sync).mockRejectedValueOnce(new Error('invalid-auth'));
    expect((await client.listResources()).resources).toEqual([]);
    expect(api.getAccounts).not.toHaveBeenCalled();
    expect((await client.listResources()).resources).toHaveLength(2);
    expect(api.shutdown).not.toHaveBeenCalled();
  });
});

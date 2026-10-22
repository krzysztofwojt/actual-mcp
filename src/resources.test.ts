import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupResources } from './resources.js';

interface FakeAccount {
  id: string;
  name: string;
  type: string;
  closed: boolean;
  offbudget: boolean;
}

type ResourceHandler = (request?: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  withBudgetLock: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  withSyncedRead: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  shutdownActualApi: vi.fn(async () => undefined),
  sdkShutdown: vi.fn(async () => undefined),
  apiGetAccounts: vi.fn(async () => [] as FakeAccount[]),
  apiGetTransactions: vi.fn(async () => []),
  fetchAllAccounts: vi.fn(async () => [] as FakeAccount[]),
  fetchCurrentAccountBalance: vi.fn(async () => 0),
}));

vi.mock('@actual-app/api', () => ({
  default: {
    getAccounts: mocks.apiGetAccounts,
    getTransactions: mocks.apiGetTransactions,
    shutdown: mocks.sdkShutdown,
  },
}));

vi.mock('./actual-api.js', () => ({
  withSyncedRead: mocks.withSyncedRead,
  shutdownActualApi: mocks.shutdownActualApi,
}));

vi.mock('./core/runtime/operation-queue.js', () => ({
  withBudgetLock: mocks.withBudgetLock,
}));

vi.mock('./core/data/fetch-accounts.js', () => ({
  fetchAllAccounts: mocks.fetchAllAccounts,
}));

vi.mock('./core/data/account-balance.js', () => ({
  fetchCurrentAccountBalance: mocks.fetchCurrentAccountBalance,
}));

const account: FakeAccount = {
  id: 'account-1',
  name: 'Checking',
  type: 'Checking',
  closed: false,
  offbudget: false,
};

function registerHandlers(): ResourceHandler[] {
  const handlers: ResourceHandler[] = [];
  const server = {
    setRequestHandler: vi.fn((_schema: unknown, handler: unknown) => {
      handlers.push(handler as ResourceHandler);
    }),
  } as unknown as Server;

  setupResources(server);
  expect(server.setRequestHandler).toHaveBeenCalledTimes(2);
  return handlers;
}

function expectOneLockedSyncedScope(): void {
  expect(mocks.withBudgetLock).toHaveBeenCalledTimes(1);
  expect(mocks.withSyncedRead).toHaveBeenCalledTimes(1);
  expect(mocks.events.slice(0, 2)).toEqual(['lock:start', 'sync:start']);
  expect(mocks.events.slice(-2)).toEqual(['sync:end', 'lock:end']);
  expect(mocks.shutdownActualApi).not.toHaveBeenCalled();
  expect(mocks.sdkShutdown).not.toHaveBeenCalled();
}

describe('setupResources request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.withBudgetLock.mockImplementation(async (operation) => {
      mocks.events.push('lock:start');
      try {
        return await operation();
      } finally {
        mocks.events.push('lock:end');
      }
    });
    mocks.withSyncedRead.mockImplementation(async (operation) => {
      mocks.events.push('sync:start');
      try {
        return await operation();
      } finally {
        mocks.events.push('sync:end');
      }
    });
    mocks.apiGetAccounts.mockImplementation(async () => {
      mocks.events.push('api:get-accounts');
      return [account];
    });
    mocks.fetchAllAccounts.mockImplementation(async () => {
      mocks.events.push('fetch:all-accounts');
      return [account];
    });
    mocks.fetchCurrentAccountBalance.mockResolvedValue(12345);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists resources inside one budget lock and one synced-read scope', async () => {
    const [listResources] = registerHandlers();

    const result = (await listResources()) as { resources: Array<{ uri: string }> };

    expect(result.resources.map(({ uri }) => uri)).toEqual([
      'actual://accounts/account-1',
      'actual://accounts/account-1/transactions',
    ]);
    expect(mocks.fetchAllAccounts).toHaveBeenCalledTimes(1);
    expectOneLockedSyncedScope();
  });

  it('reads an account inside one budget lock and one synced-read scope', async () => {
    const [, readResource] = registerHandlers();

    const result = (await readResource({ params: { uri: 'actual://accounts/account-1' } })) as {
      contents: Array<{ text: string }>;
    };

    expect(result.contents[0].text).toContain('# Account: Checking');
    expect(result.contents[0].text).toContain('Balance:');
    expect(mocks.apiGetAccounts).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCurrentAccountBalance).toHaveBeenCalledWith('account-1');
    expectOneLockedSyncedScope();
  });

  it('propagates resource-list failures without shutting down the SDK', async () => {
    const failure = new Error('account listing failed');
    mocks.fetchAllAccounts.mockRejectedValue(failure);
    const [listResources] = registerHandlers();

    await expect(listResources()).rejects.toBe(failure);

    expectOneLockedSyncedScope();
  });

  it('propagates resource-read failures without shutting down the SDK', async () => {
    const failure = new Error('account read failed');
    mocks.apiGetAccounts.mockRejectedValue(failure);
    const [, readResource] = registerHandlers();

    await expect(readResource({ params: { uri: 'actual://accounts' } })).rejects.toBe(failure);

    expectOneLockedSyncedScope();
  });
});

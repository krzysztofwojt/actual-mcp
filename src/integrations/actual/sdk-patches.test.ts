import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server, type RequestListener } from 'node:http';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

const sdk = readFileSync(createRequire(import.meta.url).resolve('@actual-app/api'), 'utf8');
class TestPostError extends Error {
  constructor(
    readonly reason: string,
    _unused?: unknown,
    options?: ErrorOptions
  ) {
    super(reason, options);
  }
}
const statusError = new TestPostError('unauthorized');
const postBinary = runInNewContext(
  sdk.slice(
    sdk.indexOf('async function postBinary('),
    sdk.indexOf('function get$1(', sdk.indexOf('async function postBinary('))
  ) + '\npostBinary;',
  {
    process,
    AbortController,
    setTimeout,
    clearTimeout,
    Buffer,
    fetch$1: fetch,
    PostError: TestPostError,
    throwIfNot200: (response: Response): void => {
      if (response.status !== 200) throw statusError;
    },
  }
) as (url: string, data: Buffer, headers: object) => Promise<Buffer>;
const servers: Server[] = [];
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })
  );
});
it('executes the installed binary sync patch successfully', async () => {
  const origin = await listen((_request, response) => response.end('binary'));
  expect(await postBinary(origin, Buffer.from('fixture'), {})).toEqual(Buffer.from('binary'));
});
it('keeps the deadline active while reading a stalled response body', async () => {
  vi.stubEnv('ACTUAL_SYNC_REQUEST_TIMEOUT_MS', '50');
  const origin = await listen((_request, response) => {
    response.writeHead(200);
    response.write('partial');
  });
  await expect(postBinary(origin, Buffer.from('fixture'), {})).rejects.toMatchObject({
    reason: 'network-failure',
    cause: { name: 'AbortError' },
  });
});
it('preserves HTTP errors rather than misclassifying them as retryable network failures', async () => {
  const origin = await listen((_request, response) => {
    response.writeHead(401);
    response.end('rejected');
  });
  await expect(postBinary(origin, Buffer.from('fixture'), {})).rejects.toBe(statusError);
});
it.each(['network-failure', 'unauthorized'])(
  'does not print %s sync stacks inside the installed SDK',
  async (reason) => {
    const logger = { log: vi.fn() };
    const failure = new TestPostError(reason);
    const start = sdk.indexOf('var fullSync = once(async function()');
    const fullSync = runInNewContext(
      sdk.slice(start, sdk.indexOf('async function _fullSync(', start)) + '\nfullSync;',
      {
        once: (fn: unknown): unknown => fn,
        app$22: { events: { emit: vi.fn() } },
        _fullSync: async (): Promise<never> => {
          throw failure;
        },
        logger,
        PostError: TestPostError,
        setItem: vi.fn(),
        SyncError: class extends Error {},
      }
    ) as () => Promise<unknown>;
    expect(await fullSync()).toMatchObject({ error: { reason } });
    expect(logger.log).not.toHaveBeenCalled();
  }
);

it('the installed CRDT sender replays existing timestamps rather than creating new financial mutations', async () => {
  const post = vi
    .fn()
    .mockRejectedValueOnce(new TestPostError('network-failure'))
    .mockResolvedValue(Buffer.from('ack'));
  const timestamp = '2026-09-30T12:00:00.000Z-0000-fixture';
  const messages = [{ timestamp, dataset: 'transactions', row: 'fixture', column: 'amount', value: 1 }];
  const start = sdk.indexOf('async function _fullSync(');
  const send = runInNewContext(sdk.slice(start, sdk.indexOf('//#endregion', start)) + '\n_fullSync;', {
    getPrefs: (): object => ({
      id: 'local-fixture',
      cloudFileId: 'cloud-fixture',
      groupId: 'group-fixture',
      lastSyncedTimestamp: timestamp,
    }),
    clearFullSyncTimeout: vi.fn(),
    checkSyncingMode: (): boolean => false,
    getClock: (): object => ({ timestamp: { toString: (): string => timestamp }, merkle: {} }),
    getMessagesSince: (): object[] => messages,
    getItem: async (): Promise<string> => 'local-fixture',
    logger: { info: vi.fn() },
    encode: async (group: string, file: string, since: string, pending: object[]): Promise<Buffer> =>
      Buffer.from(JSON.stringify({ group, file, since, pending })),
    postBinary: post,
    getServer: (): object => ({ SYNC_SERVER: 'http://fixture.invalid' }),
    decode: async (): Promise<object> => ({ messages: [], merkle: {} }),
    diff: (): null => null,
  }) as (since: null, count: number, previous: null) => Promise<unknown>;
  await expect(send(null, 0, null)).rejects.toMatchObject({ reason: 'network-failure' });
  await expect(send(null, 0, null)).resolves.toEqual([]);
  expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1]);
  expect(JSON.parse(post.mock.calls[1][1].toString()).pending[0].timestamp).toBe(timestamp);
});

it.each([
  ['post', 'async function del('],
  ['del', 'async function patch('],
  ['patch', 'async function postBinary('],
])('redacts request data and URLs from SDK %s rejection logging', async (method, next) => {
  const log = vi.fn();
  const start = sdk.indexOf(`async function ${method}(`);
  const post = runInNewContext(sdk.slice(start, sdk.indexOf(next, start)) + `\n${method};`, {
    fetch$1: fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    throwIfNot200: vi.fn(),
    PostError: TestPostError,
    logger: { log },
  }) as (url: string, data: object) => Promise<unknown>;
  const origin = await listen((_request, response) => {
    response.end(JSON.stringify({ status: 'error', reason: 'unauthorized' }));
  });
  await expect(post(origin, { password: 'sensitive-local-fixture' })).rejects.toMatchObject({ reason: 'unauthorized' });
  expect(log).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain(origin);
  expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive-local-fixture');
});

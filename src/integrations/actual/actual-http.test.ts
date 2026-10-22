import { createServer, type Server, type RequestListener } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import type { Socket } from 'node:net';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
// The SDK caches built-in fetch before configureActualHttp installs a dispatcher.
import * as api from '@actual-app/api';
import { actualHttpOptions, closeActualHttp, configureActualHttp, inActualHttpAttempt } from './actual-http.js';

const dataDir = mkdtempSync(join(tmpdir(), 'actual-http-'));
const servers: Server[] = [];
const agents: Agent[] = [];
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
const originalDispatcher = getGlobalDispatcher();
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => {
  await api.shutdown();
  await closeActualHttp();
  setGlobalDispatcher(originalDispatcher);
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })
  );
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('reproduces UND_ERR_SOCKET on reuse before the fix, then retires idle sockets before reuse', async () => {
  const sockets = new Set<Socket>();
  const origin = await listen((request, response) => {
    if (sockets.has(request.socket)) {
      // Simulate the server closing an idle socket as the next request arrives.
      request.socket.destroy();
      return;
    }
    sockets.add(request.socket);
    response.setHeader('Keep-Alive', 'timeout=5');
    response.end('ok');
  });
  const baseline = new Agent({ connections: 1, keepAliveTimeout: 10000, keepAliveTimeoutThreshold: 0 });
  agents.push(baseline);
  setGlobalDispatcher(baseline);
  const post = async (): Promise<string> => (await fetch(origin, { method: 'POST', body: 'sync-envelope' })).text();
  expect(await post()).toBe('ok');
  await tick();
  await expect(post()).rejects.toMatchObject({ cause: { code: 'UND_ERR_SOCKET' } });

  vi.stubEnv('ACTUAL_SERVER_URL', origin);
  vi.stubEnv('ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS', '50');
  configureActualHttp();
  expect(await post()).toBe('ok');
  const used = [...sockets].at(-1)!;
  await once(used, 'close');
  expect(await post()).toBe('ok');
  expect(sockets.size).toBe(3);
});

it('uses a dedicated new socket for a retry and restores the ordinary pool afterwards', async () => {
  const seen: Socket[] = [];
  const origin = await listen((request, response) => {
    seen.push(request.socket);
    response.end('ok');
  });
  vi.stubEnv('ACTUAL_SERVER_URL', origin);
  configureActualHttp();
  const post = async (): Promise<string> => (await fetch(origin, { method: 'POST' })).text();
  await post();
  await tick();
  await inActualHttpAttempt(true, post);
  await tick();
  await post();
  expect(seen[1]).not.toBe(seen[0]);
  expect(seen[2]).toBe(seen[0]);
});

it('routes the cached SDK built-in fetch and preserves the dispatcher for other origins', async () => {
  const seen: Socket[] = [];
  const origin = await listen((request, response) => {
    seen.push(request.socket);
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Keep-Alive', 'timeout=5');
    response.end(JSON.stringify({ status: 'ok', data: { token: 'local-fixture', version: '26.9.0' } }));
  });
  const other = await listen((_request, response) => response.end('other'));
  const fallback = new Agent();
  agents.push(fallback);
  const dispatch = vi.spyOn(fallback, 'dispatch');
  setGlobalDispatcher(fallback);
  vi.stubEnv('ACTUAL_SERVER_URL', origin);
  vi.stubEnv('ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS', '50');
  configureActualHttp();
  await api.init({ dataDir: dataDir, serverURL: origin, password: 'local-fixture' });
  const loginSocket = seen.at(-1)!;
  await once(loginSocket, 'close');
  await api.getServerVersion();
  expect(seen.at(-1)).not.toBe(loginSocket);
  expect(dispatch).not.toHaveBeenCalled();
  expect(await (await fetch(other)).text()).toBe('other');
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it('caps server hints and rejects invalid or unsafe keep-alive configuration', () => {
  for (const value of ['', '-1', 'NaN', '5000', '2.5']) {
    vi.stubEnv('ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS', value);
    expect(actualHttpOptions()).toMatchObject({ keepAliveTimeout: 2000, keepAliveMaxTimeout: 2000 });
  }
  vi.stubEnv('ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS', '1500');
  expect(actualHttpOptions().keepAliveMaxTimeout).toBe(1500);
});

it('bounds stalled response headers with the configured transport timeout', async () => {
  const origin = await listen((request) => request.resume());
  vi.stubEnv('ACTUAL_SERVER_URL', origin);
  vi.stubEnv('ACTUAL_HTTP_REQUEST_TIMEOUT_MS', '50');
  configureActualHttp();
  await expect(fetch(origin, { method: 'POST' })).rejects.toMatchObject({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
});

import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import { once, type EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ app: undefined as Express | undefined }));
vi.mock('express', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof import('express') }>();
  const factory = Object.assign(() => {
    const app = original.default();
    state.app = app;
    // Reason: exercise the entrypoint routes on a separate loopback-only listener.
    app.listen = vi.fn() as unknown as Express['listen'];
    return app;
  }, original.default);
  return { ...original, default: factory };
});
vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:util')>()),
  parseArgs: () => ({ values: { sse: true, 'enable-bearer': true } }),
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('./actual-api.js', () => ({ initActualApi: vi.fn(), shutdownActualApi: vi.fn() }));
vi.mock('./core/data/fetch-accounts.js', () => ({ fetchAllAccounts: vi.fn() }));
vi.mock('./integrations/actual/connection.js', () => ({ getActualConnection: vi.fn() }));
vi.mock('./integrations/actual/actual-warmup.js', () => ({ warmActualApiUntilReady: vi.fn() }));
vi.mock('./resources.js', () => ({ setupResources: vi.fn() }));
vi.mock('./tools/index.js', () => ({ setupTools: vi.fn() }));
vi.mock('./prompts.js', () => ({ setupPrompts: vi.fn() }));

let listener: Server;
let origin: string;
const events = ['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'] as const;
const processEvents: EventEmitter = process;
const originalListeners = events.map((event) => new Set(processEvents.listeners(event)));
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'local-test', version: '1' } },
};

beforeAll(async () => {
  vi.stubEnv('BEARER_TOKEN', 'local-test-token');
  await import('./index.js');
  listener = createServer(state.app!);
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  origin = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
});

afterAll(async () => {
  listener.closeAllConnections();
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  events.forEach((event, index) => {
    for (const handler of processEvents.listeners(event)) {
      if (!originalListeners[index].has(handler))
        processEvents.removeListener(event, handler as (...args: unknown[]) => void);
    }
  });
  vi.unstubAllEnvs();
});

async function request(
  path: string,
  method: string,
  session?: string,
  body: unknown = { jsonrpc: '2.0', id: 2, method: 'ping' },
  authorized = true
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(authorized ? { Authorization: 'Bearer local-test-token' } : {}),
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

describe.each(['/', '/mcp'])('Streamable HTTP %s', (path) => {
  it.each(['POST', 'GET', 'DELETE'])('returns 404 for unknown sessions on %s', async (method) => {
    const response = await request(path, method, 'unknown-session');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found' },
      id: null,
    });
  });

  it('rejects initialize with an unknown session instead of creating a session', async () => {
    const response = await request(path, 'POST', 'expired-session', initialize);
    expect(response.status).toBe(404);
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it.each(['POST', 'GET', 'DELETE'])('authenticates before checking sessions on %s', async (method) => {
    const response = await request(path, method, 'unknown-session', undefined, false);
    expect(response.status).toBe(401);
    await response.body?.cancel();
  });

  it.each(['POST', 'DELETE'])('returns 400 without a session on %s', async (method) => {
    const response = await request(path, method);
    expect(response.status).toBe(400);
    await response.body?.cancel();
  });

  it('returns 400 for a sessionless GET without the legacy SSE Accept header', async () => {
    const response = await fetch(`${origin}${path}`, {
      headers: { Authorization: 'Bearer local-test-token', Accept: 'application/json' },
    });
    expect(response.status).toBe(400);
    await response.body?.cancel();
  });

  it('initializes, accepts a valid session, and returns 404 after deletion', async () => {
    const response = await request(path, 'POST', undefined, initialize);
    expect(response.status).toBe(200);
    const session = response.headers.get('mcp-session-id');
    expect(session).toBeTruthy();
    await response.text();
    const ping = await request(path, 'POST', session!);
    expect(ping.status).toBe(200);
    expect(await ping.text()).toContain('"result":{}');
    const stream = await request(path, 'GET', session!);
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    const deleted = await request(path, 'DELETE', session!);
    expect(deleted.status).toBe(200);
    await deleted.body?.cancel();
    expect((await request(path, 'POST', session!)).status).toBe(404);
  });
});

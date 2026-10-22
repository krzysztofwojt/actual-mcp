import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../actual-api.js', () => ({ syncActual: vi.fn() }));
import { syncActual } from '../../actual-api.js';
import { executeMutation } from './operation-runtime.js';
import { success } from '../../utils/response.js';
import { configureActualHttp, closeActualHttp } from '../../integrations/actual/actual-http.js';

const directory = mkdtempSync(join(tmpdir(), 'actual-conn-write-'));
afterEach(async () => {
  await closeActualHttp();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  rmSync(directory, { force: true, recursive: true });
});
it('does not replay a financial write when the server commits it then closes the socket', async () => {
  let committed = 0;
  const server = createServer((request) => {
    request.resume();
    request.on('end', () => {
      committed++;
      request.socket.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv('ACTUAL_SERVER_URL', origin);
  vi.stubEnv('ACTUAL_MCP_STATE_DIR', directory);
  configureActualHttp();
  const mutate = vi.fn(async () => {
    await fetch(origin, { method: 'POST', body: 'local-financial-write-fixture' });
    return success('created');
  });
  try {
    await expect(
      executeMutation({ operationId: 'financial-write-1', tool: 'create-transaction', args: {}, mutate })
    ).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN');
    expect(committed).toBe(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(syncActual).toHaveBeenCalledTimes(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('does not replay the mutation when post-write synchronization fails', async () => {
  vi.stubEnv('ACTUAL_MCP_STATE_DIR', directory);
  vi.mocked(syncActual).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network-failure'));
  const mutate = vi.fn().mockResolvedValue(success('created'));
  await expect(
    executeMutation({ operationId: 'financial-write-2', tool: 'import-transactions', args: {}, mutate })
  ).rejects.toThrow('Reconcile the budget');
  expect(mutate).toHaveBeenCalledTimes(1);
});

it('does not label a failed pre-write refresh as an uncertain financial write', async () => {
  vi.stubEnv('ACTUAL_MCP_STATE_DIR', directory);
  const failure = Object.assign(new Error('offline'), { code: 'ECONNRESET' });
  vi.mocked(syncActual).mockRejectedValueOnce(failure);
  const mutate = vi.fn();
  await expect(
    executeMutation({ operationId: 'pre-write', tool: 'create-transaction', args: {}, mutate })
  ).rejects.toBe(failure);
  expect(mutate).not.toHaveBeenCalled();
});

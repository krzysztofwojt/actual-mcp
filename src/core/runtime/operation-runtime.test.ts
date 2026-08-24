import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { success } from '../../utils/response.js';
import { executeMutation } from './operation-runtime.js';

vi.mock('../../actual-api.js', () => ({ syncActual: vi.fn() }));

import { syncActual } from '../../actual-api.js';

describe('operation runtime', () => {
  let stateDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-operation-'));
    process.env.ACTUAL_MCP_STATE_DIR = stateDir;
  });

  afterEach(() => {
    delete process.env.ACTUAL_MCP_STATE_DIR;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('syncs before and after a successful mutation and persists its result', async () => {
    const mutate = vi.fn().mockResolvedValue(success('done'));
    const result = await executeMutation({
      operationId: 'operation-1',
      tool: 'test-write',
      args: { value: 1 },
      mutate,
    });

    expect(result).toEqual(success('done'));
    expect(syncActual).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(stateDir, '.actual-mcp-operation-ledger.json'), 'utf8')).toContain('operation-1');
  });

  it('returns the durable prior result instead of executing a duplicate', async () => {
    const first = vi.fn().mockResolvedValue(success('first'));
    await executeMutation({ operationId: 'operation-2', tool: 'test-write', args: { value: 2 }, mutate: first });
    vi.clearAllMocks();
    const duplicate = vi.fn().mockResolvedValue(success('duplicate'));

    const result = await executeMutation({
      operationId: 'operation-2',
      tool: 'test-write',
      args: { value: 2 },
      mutate: duplicate,
    });

    expect(result).toEqual(success('first'));
    expect(duplicate).not.toHaveBeenCalled();
    expect(syncActual).not.toHaveBeenCalled();
  });

  it('rejects reuse of an operation id with different arguments', async () => {
    await executeMutation({
      operationId: 'operation-3',
      tool: 'test-write',
      args: { value: 3 },
      mutate: vi.fn().mockResolvedValue(success('done')),
    });

    await expect(
      executeMutation({
        operationId: 'operation-3',
        tool: 'test-write',
        args: { value: 4 },
        mutate: vi.fn().mockResolvedValue(success('wrong')),
      })
    ).rejects.toThrow('OPERATION_ID_CONFLICT');
  });
});

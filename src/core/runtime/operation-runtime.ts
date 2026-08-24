import fs from 'fs';
import os from 'os';
import path from 'path';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { syncActual } from '../../actual-api.js';

interface LedgerEntry {
  operationId: string;
  tool: string;
  argsHash: string;
  completedAt: string;
  result: CallToolResult;
}

interface AuditEntry {
  timestamp: string;
  operationId: string;
  tool: string;
  status: 'started' | 'queued' | 'running' | 'completed' | 'failed';
  args?: unknown;
  result?: CallToolResult;
  error?: string;
}

const RETENTION_DAYS = 90;
const SECRET_KEY = /(password|token|secret|authorization|cookie)/i;

export function operationStateRoot(): string {
  return process.env.ACTUAL_MCP_STATE_DIR || process.env.ACTUAL_DATA_DIR || path.join(os.homedir(), '.actual');
}

function ledgerPath(): string {
  return path.join(operationStateRoot(), '.actual-mcp-operation-ledger.json');
}

function auditPath(now = new Date()): string {
  return path.join(operationStateRoot(), `.actual-mcp-audit-${now.toISOString().slice(0, 7)}.jsonl`);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : stable(item)])
    );
  }
  return value;
}

function argsHash(args: unknown): string {
  return JSON.stringify(stable(args));
}

function readLedger(): LedgerEntry[] {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')) as LedgerEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function writeLedger(entries: LedgerEntry[]): void {
  fs.mkdirSync(operationStateRoot(), { recursive: true });
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retained = entries.filter((entry) => Date.parse(entry.completedAt) >= cutoff);
  const target = ledgerPath();
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(retained, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

export function appendAuditEvent(entry: AuditEntry): void {
  fs.mkdirSync(operationStateRoot(), { recursive: true });
  fs.appendFileSync(auditPath(), `${JSON.stringify(stable(entry))}\n`, { mode: 0o600 });
  const cutoff = new Date();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  const oldestRetainedMonth = cutoff.toISOString().slice(0, 7);
  for (const filename of fs.readdirSync(operationStateRoot())) {
    const match = /^\.actual-mcp-audit-(\d{4}-\d{2})\.jsonl$/.exec(filename);
    if (match && match[1] < oldestRetainedMonth) {
      fs.unlinkSync(path.join(operationStateRoot(), filename));
    }
  }
}

export interface MutationRequest {
  operationId: string;
  tool: string;
  args: Record<string, unknown>;
  mutate: () => Promise<CallToolResult>;
}

/** Execute one durable, idempotent mutation with sync and audit guarantees. */
export async function executeMutation(request: MutationRequest): Promise<CallToolResult> {
  const hash = argsHash(request.args);
  const ledger = readLedger();
  const previous = ledger.find((entry) => entry.operationId === request.operationId);
  if (previous) {
    if (previous.tool !== request.tool || previous.argsHash !== hash) {
      throw new Error(`OPERATION_ID_CONFLICT: ${request.operationId} was already used with different arguments`);
    }
    return previous.result;
  }

  appendAuditEvent({
    timestamp: new Date().toISOString(),
    operationId: request.operationId,
    tool: request.tool,
    status: 'started',
    args: request.args,
  });

  try {
    await syncActual();
    const result = await request.mutate();
    if (result.isError)
      throw new Error(result.content[0]?.type === 'text' ? result.content[0].text : 'Mutation failed');
    await syncActual();
    const completed: LedgerEntry = {
      operationId: request.operationId,
      tool: request.tool,
      argsHash: hash,
      completedAt: new Date().toISOString(),
      result,
    };
    writeLedger([...ledger, completed]);
    appendAuditEvent({
      timestamp: completed.completedAt,
      operationId: request.operationId,
      tool: request.tool,
      status: 'completed',
      result,
    });
    return result;
  } catch (error) {
    appendAuditEvent({
      timestamp: new Date().toISOString(),
      operationId: request.operationId,
      tool: request.tool,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function withoutOperationId(args: Record<string, unknown>): Record<string, unknown> {
  const { operationId: _operationId, ...clean } = args;
  return clean;
}

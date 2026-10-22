import * as api from '@actual-app/api';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { actualNetworkErrorCode, retryActualOperation } from './actual-retry.js';

let inFlightSync: Promise<void> | null = null;
function readyFile(): string {
  return path.join(process.env.ACTUAL_DATA_DIR || path.resolve(os.homedir() || '.', '.actual'), '.actual-mcp-ready');
}
export function clearActualReady(): void {
  try {
    fs.rmSync(readyFile(), { force: true });
  } catch {
    /* readiness is best-effort */
  }
}
export function markActualReady(): void {
  try {
    fs.mkdirSync(path.dirname(readyFile()), { recursive: true });
    fs.writeFileSync(readyFile(), new Date().toISOString());
  } catch (error) {
    console.error('Failed to write Actual MCP readiness marker:', error);
  }
}
export function isRetryableActualNetworkError(error: unknown): boolean {
  return actualNetworkErrorCode(error) !== undefined;
}
export async function retrySync(): Promise<void> {
  if (inFlightSync) return inFlightSync;
  inFlightSync = retryActualOperation('sync', () => api.sync());
  try {
    await inFlightSync;
    markActualReady();
  } catch (error) {
    clearActualReady();
    throw error;
  } finally {
    inFlightSync = null;
  }
}
export async function initWithRetry(initConfig: Parameters<typeof api.init>[0]): Promise<void> {
  await retryActualOperation('login', async (attempt) => {
    if (attempt > 1) await api.shutdown();
    await api.init(initConfig);
  });
}
export async function downloadBudgetWithRetry(
  initConfig: Parameters<typeof api.init>[0],
  budgetId: string,
  downloadOptions: Parameters<typeof api.downloadBudget>[1]
): Promise<void> {
  await retryActualOperation('download', async (attempt) => {
    if (attempt > 1) {
      await api.shutdown();
      await api.init(initConfig);
    }
    await api.downloadBudget(budgetId, downloadOptions);
  });
}

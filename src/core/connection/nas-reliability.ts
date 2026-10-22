import * as api from '@actual-app/api';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let inFlightSync: Promise<void> | null = null;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
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
  const value = error as Record<string, unknown> | null;
  const message = [value?.name, value?.type, value?.code, value?.message, value?.reason]
    .filter(Boolean)
    .map(String)
    .join(' ')
    .toLowerCase();
  return /network|socket|timeout|econn|fetch|connection|temporar|other side closed/.test(message);
}
export async function retrySync(): Promise<void> {
  if (inFlightSync) return inFlightSync;
  inFlightSync = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api.sync();
        markActualReady();
        return;
      } catch (error) {
        lastError = error;
        clearActualReady();
        console.error('Actual server sync failed (on-demand, attempt ' + (attempt + 1) + '/3):', error);
        if (!isRetryableActualNetworkError(error) || attempt === 2) break;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastError;
  })();
  try {
    return await inFlightSync;
  } finally {
    inFlightSync = null;
  }
}
export async function downloadBudgetWithRetry(
  initConfig: Parameters<typeof api.init>[0],
  budgetId: string,
  downloadOptions: Parameters<typeof api.downloadBudget>[1]
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await api.downloadBudget(budgetId, downloadOptions);
      return;
    } catch (error) {
      lastError = error;
      console.error('Actual Budget download failed (attempt ' + (attempt + 1) + '/3):', error);
      if (!isRetryableActualNetworkError(error) || attempt === 2) break;
      try {
        await api.shutdown();
      } catch {
        /* reset a failed session */
      }
      await sleep(750 * (attempt + 1));
      await api.init(initConfig);
    }
  }
  throw lastError;
}

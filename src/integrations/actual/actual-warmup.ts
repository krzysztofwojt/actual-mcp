import { actualNetworkErrorCode } from './reliability.js';

/** Preserve background readiness recovery, but stop on configuration or authentication errors. */
export async function warmActualApiUntilReady(
  initialize: () => Promise<void>,
  shouldStop: () => boolean = () => false
): Promise<void> {
  while (!shouldStop()) {
    try {
      await initialize();
      process.stderr.write('Actual Budget API warmup complete\n');
      return;
    } catch (error) {
      if (actualNetworkErrorCode(error) === undefined) {
        process.stderr.write('Actual Budget API warmup stopped: non-transient initialization failure\n');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
}

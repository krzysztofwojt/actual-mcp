import { inActualHttpAttempt, positiveEnv } from './actual-http.js';

export type SafeActualOperation = 'login' | 'download' | 'sync';
const transientCodes = new Set([
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_ABORTED',
]);
interface ErrorFields {
  code?: unknown;
  reason?: unknown;
  name?: unknown;
  message?: unknown;
  cause?: unknown;
}

/** Only known transport errors and the SDK's exact network-failure code qualify. */
export function actualNetworkErrorCode(error: unknown): string | undefined {
  const visited = new Set<unknown>();
  let value = error;
  let sdkNetwork = false;
  while (value && typeof value === 'object' && !visited.has(value)) {
    visited.add(value);
    const fields = value as ErrorFields;
    if (typeof fields.code === 'string' && transientCodes.has(fields.code)) return fields.code;
    if (
      fields.code === 'network-failure' ||
      fields.reason === 'network-failure' ||
      fields.message === 'Authentication failed: network-failure'
    )
      sdkNetwork = true;
    // Certificate, authentication, protocol, and other known failures are terminal.
    else if (typeof fields.code === 'string') return undefined;
    value = fields.cause;
  }
  return sdkNetwork ? 'network-failure' : undefined;
}

/** No financial mutation callback is accepted here: callers name a reviewed safe operation. */
export async function retryActualOperation<T>(
  operation: SafeActualOperation,
  run: (attempt: number) => Promise<T>
): Promise<T> {
  const attempts = positiveEnv('ACTUAL_HTTP_RETRY_ATTEMPTS', 3, 5);
  const delay = positiveEnv('ACTUAL_HTTP_RETRY_DELAY_MS', 500, 10000);
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await inActualHttpAttempt(attempt > 1, async (context) => {
        try {
          return await run(attempt);
        } catch (error) {
          const sdkCode = actualNetworkErrorCode(error);
          const code =
            sdkCode === undefined
              ? undefined
              : context.transportError === undefined
                ? sdkCode
                : actualNetworkErrorCode(context.transportError);
          const retry = code !== undefined && attempt < attempts;
          console.error(
            JSON.stringify({
              event: 'actual-attempt-failed',
              operation,
              attempt,
              attempts,
              code: code ?? 'NON_TRANSIENT',
              freshConnection: context.fresh,
              elapsedMs: Date.now() - started,
              retry,
            })
          );
          if (!retry) throw error;
          // Retain the decision separately; never classify or log arbitrary error text.
          throw new RetryableAttempt(error);
        }
      });
      if (attempt > 1)
        console.error(
          JSON.stringify({
            event: 'actual-retry-succeeded',
            operation,
            attempts: attempt,
            elapsedMs: Date.now() - started,
          })
        );
      return result;
    } catch (error) {
      if (!(error instanceof RetryableAttempt)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
}
class RetryableAttempt extends Error {
  constructor(cause: unknown) {
    super('retryable Actual transport failure', { cause });
  }
}

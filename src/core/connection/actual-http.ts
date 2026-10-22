import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent, Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

export interface ActualHttpOptions {
  keepAliveTimeout: number;
  keepAliveMaxTimeout: number;
  keepAliveTimeoutThreshold: number;
}
export interface AttemptContext {
  fresh: boolean;
  transportError?: unknown;
}
interface HttpScope extends AttemptContext {
  agent?: Agent;
}
const scope = new AsyncLocalStorage<HttpScope>();

export function positiveEnv(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}
export function actualHttpOptions(): ActualHttpOptions {
  const timeout = positiveEnv('ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS', 2000, 4000);
  return {
    keepAliveTimeout: timeout,
    // # Reason: the server's Keep-Alive hint otherwise overrides keepAliveTimeout.
    keepAliveMaxTimeout: timeout,
    keepAliveTimeoutThreshold: 1000,
  };
}

/** Routes only Actual's origin; all other network clients retain their dispatcher. */
export class ActualHttpDispatcher extends Dispatcher {
  readonly agent: Agent;
  constructor(
    readonly origin: string,
    readonly fallback: Dispatcher,
    readonly options: ActualHttpOptions = actualHttpOptions()
  ) {
    super();
    this.agent = new Agent(options);
  }
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    if (new URL(String(options.origin)).origin !== this.origin) return this.fallback.dispatch(options, handler);
    const context = scope.getStore();
    const wrapped = Object.create(handler) as Dispatcher.DispatchHandler;
    wrapped.onError = (error: Error): void => {
      if (context) context.transportError = error;
      handler.onError?.(error);
    };
    return (context?.agent ?? this.agent).dispatch(options, wrapped);
  }
}

let installed: ActualHttpDispatcher | undefined;
export function configureActualHttp(): void {
  if (installed || !process.env.ACTUAL_SERVER_URL) return;
  const origin = new URL(process.env.ACTUAL_SERVER_URL).origin;
  installed = new ActualHttpDispatcher(origin, getGlobalDispatcher());
  // Node's built-in fetch consults this dispatcher even when the SDK cached fetch.
  setGlobalDispatcher(installed);
}
export async function closeActualHttp(): Promise<void> {
  const previous = installed;
  if (!previous) return;
  installed = undefined;
  if (getGlobalDispatcher() === previous) setGlobalDispatcher(previous.fallback);
  await previous.agent.close();
}
export async function inActualHttpAttempt<T>(
  fresh: boolean,
  operation: (context: AttemptContext) => Promise<T>
): Promise<T> {
  const context: HttpScope = { fresh, agent: fresh && installed ? new Agent(installed.options) : undefined };
  try {
    return await scope.run(context, () => operation(context));
  } finally {
    // Only this attempt owns this pool. Never destroy a concurrent request's sockets.
    await context.agent?.close();
  }
}

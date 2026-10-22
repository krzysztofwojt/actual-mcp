import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent, Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

export interface ActualHttpOptions {
  keepAliveTimeout: number;
  keepAliveMaxTimeout: number;
  keepAliveTimeoutThreshold: number;
  headersTimeout: number;
  bodyTimeout: number;
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
  const requestTimeout = positiveEnv('ACTUAL_HTTP_REQUEST_TIMEOUT_MS', 15000, 300000);
  return {
    headersTimeout: requestTimeout,
    bodyTimeout: requestTimeout,
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
    const wrapped = new Proxy(handler, {
      get(target, property): unknown {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          // Undici supports both the Node 24 legacy and newer handler contracts.
          if (context && (property === 'onError' || property === 'onResponseError')) {
            context.transportError = args.at(-1);
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
    return (context?.agent ?? this.agent).dispatch(
      {
        ...options,
        headersTimeout: this.options.headersTimeout,
        bodyTimeout: this.options.bodyTimeout,
      },
      wrapped
    );
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
    const ownedAgent = context.agent;
    // # Reason: SDK timers may inherit this scope and outlive the attempt.
    // They must use the ordinary pool once the dedicated retry pool is retired.
    context.agent = undefined;
    await ownedAgent?.close();
  }
}

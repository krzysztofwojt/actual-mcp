let operationQueue: Promise<unknown> = Promise.resolve();

/** Serialize access to the single open Actual budget. */
export function withBudgetLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = operationQueue.catch(() => undefined).then(operation);
  operationQueue = run;
  return run;
}

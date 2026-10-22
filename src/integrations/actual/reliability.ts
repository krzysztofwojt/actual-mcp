/** Retry transport failures only; validation/authentication errors must fail immediately. */
export function isRetryableNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const message = ['name', 'type', 'code', 'message', 'reason']
    .map((key) => String(record[key] ?? ''))
    .join(' ')
    .toLowerCase();
  return /network|socket|timeout|econn|fetch|connection|temporar|other side closed/.test(message);
}

export async function retryNetwork<T>(
  operation: () => Promise<T>,
  reset: () => Promise<void> = async () => {},
  delay = 500
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      await reset();
    }
  }
}

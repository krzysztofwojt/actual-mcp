import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const bundle = readFileSync(require.resolve('@actual-app/api'), 'utf8');
const source = bundle.match(/async function postBinary\(url, data, headers\) \{[\s\S]*?\n}/)![0];
class PostError extends Error {
  constructor(
    public reason: string,
    _unused?: unknown,
    public options?: { cause: unknown }
  ) {
    super(reason);
  }
}
type Fetch = (url: string, options: { signal: AbortSignal }) => Promise<unknown>;
function load(fetch: Fetch): (url: string, data: Uint8Array, headers: object) => Promise<Buffer> {
  return new Function('fetch$1', 'PostError', 'throwIfNot200', `return (${source});`)(
    fetch,
    PostError,
    (response: { status: number }) => {
      if (response.status !== 200) throw new PostError('http-error');
    }
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe('installed SDK binary sync timeout patch', () => {
  it.each(['fetch', 'body'])('aborts a hung %s and returns a network failure', async (stage) => {
    vi.useFakeTimers();
    vi.stubEnv('ACTUAL_SYNC_REQUEST_TIMEOUT_MS', '25');
    const post = load(async (_url, { signal }) => {
      const hang = (): Promise<never> =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      return stage === 'fetch' ? hang() : { status: 200, arrayBuffer: hang };
    });
    const result = expect(post('https://example.invalid/sync', new Uint8Array(), {})).rejects.toThrow(
      'network-failure'
    );
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps HTTP errors intact and clears the timer after success or failure', async () => {
    vi.useFakeTimers();
    for (const status of [200, 401]) {
      const post = load(async () => ({ status, arrayBuffer: async () => new ArrayBuffer(0) }));
      if (status === 200) await expect(post('url', new Uint8Array(), {})).resolves.toEqual(Buffer.alloc(0));
      else await expect(post('url', new Uint8Array(), {})).rejects.toThrow('http-error');
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it('falls back to 15000ms for invalid settings', async () => {
    vi.useFakeTimers();
    vi.stubEnv('ACTUAL_SYNC_REQUEST_TIMEOUT_MS', '-1');
    const post = load(
      async (_url, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    );
    const result = expect(post('url', new Uint8Array(), {})).rejects.toThrow('network-failure');
    await vi.advanceTimersByTimeAsync(14999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
  });
});

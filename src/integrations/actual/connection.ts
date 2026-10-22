import { AsyncLocalStorage } from 'node:async_hooks';
import * as api from '@actual-app/api';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { configureActualHttp, closeActualHttp } from './actual-http.js';
import { retryActualOperation } from './reliability.js';
import { BudgetFile } from '../../types.js';

const DEFAULT_DATA_DIR: string = path.resolve(os.homedir() || '.', '.actual');
const DEFAULT_SYNC_TTL_MS = 0;

/**
 * Build the `api.init()` config from environment variables.
 *
 * `ACTUAL_SESSION_TOKEN` takes precedence over `ACTUAL_PASSWORD`. A session token is
 * the only way to authenticate against a server where password login is disabled,
 * e.g. when OpenID is enforced with `ACTUAL_OPENID_ENFORCE=true`.
 *
 * @param dataDir - Local directory for budget data
 * @returns The init config for `@actual-app/api`
 */
export function buildInitConfig(dataDir: string): InitConfig {
  const serverURL = process.env.ACTUAL_SERVER_URL;
  // Reason: InitConfig is a discriminated union in 26.x — NoServerConfig forbids serverURL/password,
  // and password and sessionToken are mutually exclusive.
  if (!serverURL) return { dataDir };
  const sessionToken = process.env.ACTUAL_SESSION_TOKEN;
  if (sessionToken) {
    if (process.env.ACTUAL_PASSWORD) {
      console.error('Both ACTUAL_SESSION_TOKEN and ACTUAL_PASSWORD are set; using ACTUAL_SESSION_TOKEN.');
    }
    return { dataDir, serverURL, sessionToken };
  }
  return { dataDir, serverURL, password: process.env.ACTUAL_PASSWORD ?? '' };
}

type ConnectionState = 'idle' | 'initializing' | 'ready' | 'closing' | 'closed' | 'failed';
type ActualApi = Awaited<ReturnType<typeof api.init>>;
type InitConfig = NonNullable<Parameters<typeof api.init>[0]>;

export class ActualConnection {
  private readonly readScope = new AsyncLocalStorage<boolean>();
  private state: ConnectionState = 'idle';
  private inflightInit: Promise<void> | null = null;
  private inflightSync: Promise<void> | null = null;
  private lastSyncAt = 0;
  private queueTail: Promise<unknown> = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private actualLib: ActualApi | null = null;
  // Reason: api.init() opens native handles (lmdb/sqlite) before it resolves, and it can
  // resolve while a later init step still fails. Track "handle may exist" separately from
  // state so drainAndClose() still shuts the API down after a failed init.
  private apiOpened = false;

  private ready = false;

  constructor() {
    this.setReady(false);
  }

  isReady(): boolean {
    return this.ready;
  }

  private setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) this.lastSyncAt = 0;
    const marker = path.join(process.env.ACTUAL_DATA_DIR || DEFAULT_DATA_DIR, '.actual-mcp-ready');
    try {
      if (ready) fs.writeFileSync(marker, new Date().toISOString());
      else fs.rmSync(marker, { force: true });
    } catch (error) {
      console.error('Could not update readiness marker:', error);
    }
  }

  private isClosingOrClosed(): boolean {
    return this.state === 'closing' || this.state === 'closed';
  }

  /** Add work to the shared lifecycle queue without letting a failure block later work. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queueTail.then(operation);
    this.queueTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * Ensure readiness, then run an operation after all preceding operations.
   *
   * `operation` must call raw `api.*` functions. Calling an actual-api facade
   * wrapper would re-enter this queue and wait for its own queued operation.
   *
   * @param operation - The raw Actual API operation to execute.
   * @returns The operation result.
   */
  run<T>(operation: (actualLib: ActualApi) => Promise<T>): Promise<T> {
    if (this.isClosingOrClosed()) {
      return Promise.reject(new Error('ActualConnection is closed'));
    }
    const ready = this.ensureReady();
    return this.enqueue(async () => {
      await ready;
      return operation(this.actualLib as ActualApi);
    });
  }

  /**
   * Ensure the connection is initialized and (when already ready) not stale.
   * Concurrent callers share one in-flight init; a failed attempt is not
   * cached — the next call starts a fresh attempt.
   */
  async ensureReady(refresh = true): Promise<void> {
    if (this.state === 'closing' || this.state === 'closed') {
      throw new Error('ActualConnection is closed');
    }
    if (this.state === 'ready') {
      if (refresh && !this.readScope.getStore()) return this.syncIfStale();
      return;
    }
    if (this.state === 'initializing' && this.inflightInit) {
      return this.inflightInit;
    }
    // idle or failed → start a fresh attempt
    this.state = 'initializing';
    this.inflightInit = this.enqueue(() => this.doInit())
      .then(() => {
        if (this.state === 'initializing') {
          this.state = 'ready';
        }
      })
      .catch((err: unknown) => {
        if (this.state === 'initializing') {
          this.state = 'failed';
        }
        this.inflightInit = null;
        throw err;
      });
    return this.inflightInit;
  }

  /** One forced refresh per request; nested facade reads share its freshness. */
  async withSyncedRead<T>(operation: () => Promise<T>): Promise<T> {
    if (this.readScope.getStore()) return operation();
    await this.sync();
    return this.readScope.run(true, operation);
  }

  async sync(): Promise<void> {
    await this.ensureReady(false);
    await this.performSync();
  }

  private syncTtlMs(): number {
    const raw = process.env.ACTUAL_SYNC_TTL_MS;
    if (raw === undefined || raw === '') return DEFAULT_SYNC_TTL_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : DEFAULT_SYNC_TTL_MS;
  }

  /**
   * Pull remote changes into local data when the TTL has elapsed. Concurrent
   * stale callers share one in-flight sync. Failures propagate to prevent stale answers.
   */
  private syncIfStale(): Promise<void> {
    const ttl = this.syncTtlMs();
    if (ttl < 0) return Promise.resolve();
    if (Date.now() - this.lastSyncAt < ttl) return Promise.resolve();
    if (this.inflightSync) return this.inflightSync;

    return this.performSync();
  }

  private performSync(): Promise<void> {
    if (this.inflightSync) return this.inflightSync;
    this.inflightSync = this.enqueue(() =>
      retryActualOperation('sync', async () => {
        try {
          await api.sync();
        } catch (error) {
          this.setReady(false);
          throw error;
        }
      })
    )
      .then(() => {
        this.lastSyncAt = Date.now();
        this.setReady(true);
      })
      .finally(() => {
        this.inflightSync = null;
      });
    return this.inflightSync;
  }

  /**
   * Stop accepting new operations, await all in-flight work (init, sync, and
   * the operation queue), then shut down the underlying API. Idempotent.
   */
  async drainAndClose(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = 'closing';
    this.setReady(false);

    this.closePromise = (async () => {
      // Await in-flight init and sync first, then whatever operations are queued.
      await Promise.allSettled([this.inflightInit ?? Promise.resolve(), this.inflightSync ?? Promise.resolve()]);
      await this.queueTail.catch(() => undefined);

      if (this.apiOpened) {
        try {
          await api.shutdown();
        } catch (err) {
          console.error('Error shutting down Actual Budget API:', err);
        }
      }
      await closeActualHttp();
      this.state = 'closed';
      this.setReady(false);
      this.lastSyncAt = 0;
      this.apiOpened = false;
      this.actualLib = null;
    })();

    return this.closePromise;
  }

  /**
   * Open the API, pick a budget, and download it. On any failure after `api.init()`
   * has opened handles, releases them before rethrowing so a retry starts clean.
   */
  private async doInit(): Promise<void> {
    console.error('Initializing Actual Budget API...');
    const dataDir = process.env.ACTUAL_DATA_DIR || DEFAULT_DATA_DIR;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.apiOpened = true;
    const initConfig = buildInitConfig(dataDir);
    try {
      configureActualHttp();
      this.actualLib = await retryActualOperation('login', async (attempt) => {
        if (attempt > 1) await api.shutdown();
        return api.init(initConfig);
      });
      const budgets: BudgetFile[] = await api.getBudgets();
      if ((!budgets || budgets.length === 0) && !process.env.ACTUAL_BUDGET_SYNC_ID?.trim()) {
        throw new Error('No budgets found. Please create a budget in Actual first.');
      }

      const configuredId = process.env.ACTUAL_BUDGET_SYNC_ID?.trim();
      if (!configuredId && budgets.length !== 1)
        throw new Error('ACTUAL_BUDGET_SYNC_ID_REQUIRED: multiple budgets are available');
      const budgetId = configuredId || budgets[0]?.cloudFileId || budgets[0]?.id;
      if (!budgetId) throw new Error('ACTUAL_BUDGET_ID_MISSING');
      await retryActualOperation('download', async (attempt) => {
        if (attempt > 1) {
          await api.shutdown();
          this.actualLib = await api.init(initConfig);
        }
        await api.downloadBudget(
          budgetId,
          process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD
            ? { password: process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD }
            : undefined
        );
      });

      // Reason: seed lastSyncAt so the first call after init does not immediately sync.
      this.lastSyncAt = Date.now();
      this.setReady(true);
    } catch (err) {
      this.setReady(false);
      // Reason: api.init() already opened native handles. Release them here, before a
      // retry can call api.init() again, instead of leaving the failed attempt's state
      // around for drainAndClose() to find later. If shutdown itself fails, keep
      // apiOpened=true so drainAndClose() still attempts cleanup, but always rethrow the
      // original error rather than the shutdown error.
      try {
        await api.shutdown();
        this.apiOpened = false;
        this.actualLib = null;
      } catch (shutdownErr) {
        console.error('Error shutting down Actual Budget API after failed init:', shutdownErr);
      }
      await closeActualHttp();
      throw err;
    }
    console.error('Actual Budget API initialized successfully');
  }
}

let instance: ActualConnection | null = null;

/** Process-wide connection accessor. */
export function getActualConnection(): ActualConnection {
  if (!instance) {
    instance = new ActualConnection();
  }
  return instance;
}

/** Test-only: discard the singleton so each test starts from a clean state. */
export function resetActualConnectionForTests(): void {
  instance = null;
}

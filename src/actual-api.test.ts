import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(),
  getBudgets: vi.fn(),
  downloadBudget: vi.fn(),
  sync: vi.fn(),
  shutdown: vi.fn(),
  getTransactions: vi.fn(),
  getPayees: vi.fn().mockResolvedValue([]),
  getAccounts: vi.fn().mockResolvedValue([]),
  q: vi.fn(),
  aqlQuery: vi.fn(),
  addTransactions: vi.fn(),
  updateTransaction: vi.fn(),
}));

import * as api from '@actual-app/api';
import {
  createTransaction,
  getTransactions,
  initActualApi,
  shutdownActualApi,
  updateTransaction,
} from './actual-api.js';

describe('initActualApi syncing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(api.getBudgets).mockResolvedValue([{ id: 'budget-1', cloudFileId: 'cloud-1' }] as never);
    process.env.ACTUAL_SERVER_URL = 'https://example.invalid';
    process.env.ACTUAL_PASSWORD = 'secret';
    delete process.env.ACTUAL_SYNC_TTL_MS;
    delete process.env.ACTUAL_BUDGET_SYNC_ID;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await shutdownActualApi();
  });

  it('downloads the budget once and does not sync on the first call', async () => {
    await initActualApi();

    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
    expect(api.sync).not.toHaveBeenCalled();
  });

  it('uses the only available budget when no budget id is configured', async () => {
    await initActualApi();
    expect(api.downloadBudget).toHaveBeenCalledWith('cloud-1', undefined);
  });

  it('requires an explicit budget id when multiple budgets are available', async () => {
    vi.mocked(api.getBudgets).mockResolvedValue([
      { id: 'budget-1', cloudFileId: 'cloud-1' },
      { id: 'budget-2', cloudFileId: 'cloud-2' },
    ] as never);

    await expect(initActualApi()).rejects.toThrow('ACTUAL_BUDGET_SYNC_ID_REQUIRED');
    expect(api.downloadBudget).not.toHaveBeenCalled();
  });

  it('passes a configured sync id directly because getBudgets may expose only local ids', async () => {
    process.env.ACTUAL_BUDGET_SYNC_ID = 'configured-sync-id';

    await initActualApi();

    expect(api.downloadBudget).toHaveBeenCalledWith('configured-sync-id', undefined);
  });

  it('does not re-download the budget on later calls', async () => {
    await initActualApi();
    vi.advanceTimersByTime(120_000);
    await initActualApi();

    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
  });

  it('syncs on every later call by default', async () => {
    await initActualApi();
    await initActualApi();
    await initActualApi();
    expect(api.sync).toHaveBeenCalledTimes(2);
  });

  it('honours ACTUAL_SYNC_TTL_MS', async () => {
    process.env.ACTUAL_SYNC_TTL_MS = '0';
    await initActualApi();

    await initActualApi();
    await initActualApi();
    expect(api.sync).toHaveBeenCalledTimes(2);
  });

  it('never syncs when ACTUAL_SYNC_TTL_MS is negative', async () => {
    process.env.ACTUAL_SYNC_TTL_MS = '-1';
    await initActualApi();

    vi.advanceTimersByTime(600_000);
    await initActualApi();
    expect(api.sync).not.toHaveBeenCalled();
  });

  it('fails closed when a sync fails', async () => {
    await initActualApi();
    vi.mocked(api.sync).mockRejectedValueOnce(new Error('server unreachable'));
    await expect(initActualApi()).rejects.toThrow('server unreachable');
  });

  it('forwards omitted transaction date bounds to Actual without inventing defaults', async () => {
    vi.mocked(api.getTransactions).mockResolvedValue([]);

    await getTransactions('account-1');
    await getTransactions('account-1', undefined, '2026-05-24');

    expect(api.getTransactions).toHaveBeenNthCalledWith(1, 'account-1', undefined, undefined);
    expect(api.getTransactions).toHaveBeenNthCalledWith(2, 'account-1', undefined, '2026-05-24');
  });

  it('converts exact decimal amounts and verifies a newly created transaction', async () => {
    vi.mocked(api.getTransactions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'txn-1', amount: 1234 }] as never);
    vi.mocked(api.addTransactions).mockResolvedValue('ok');

    await expect(createTransaction('account-1', { date: '2026-08-24', amount: '12.34' })).resolves.toBe('txn-1');
    expect(api.addTransactions).toHaveBeenCalledWith(
      'account-1',
      [{ date: '2026-08-24', amount: 1234, subtransactions: undefined }],
      { runTransfers: true }
    );
  });

  it('preserves and verifies distinct payees on same-category split children', async () => {
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.getTransactions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'txn-split', amount: -1000 }] as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({
      data: [
        {
          id: 'txn-split',
          amount: -1000,
          subtransactions: [
            { amount: -400, category: 'shared-category', payee: 'payee-a' },
            { amount: -600, category: 'shared-category', payee: 'payee-b' },
          ],
        },
      ],
    } as never);

    await expect(
      createTransaction('account-1', {
        date: '2026-09-06',
        amount: '-10.00',
        subtransactions: [
          { amount: '-4.00', category: 'shared-category', payee: 'payee-a' },
          { amount: '-6.00', category: 'shared-category', payee: 'payee-b' },
        ],
      })
    ).resolves.toBe('txn-split');

    expect(api.addTransactions).toHaveBeenCalledWith(
      'account-1',
      [
        {
          date: '2026-09-06',
          amount: -1000,
          category: undefined,
          subtransactions: [
            { amount: -400, category: 'shared-category', payee: 'payee-a' },
            { amount: -600, category: 'shared-category', payee: 'payee-b' },
          ],
        },
      ],
      { runTransfers: true }
    );
  });

  it('fails an update when Actual does not return the updated transaction', async () => {
    vi.useRealTimers();
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({ data: [] });
    vi.mocked(api.updateTransaction).mockResolvedValue([]);
    await expect(updateTransaction('txn-1', { amount: '12.34' })).rejects.toThrow(
      'TRANSACTION_UPDATE_READBACK_MISMATCH'
    );
  });

  it('reads the transaction back when Actual returns undefined after a partial update', async () => {
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.updateTransaction).mockResolvedValue(undefined as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({
      data: [{ id: 'txn-1', category: 'category-2' }],
    });

    await expect(updateTransaction('txn-1', { category: 'category-2' })).resolves.toMatchObject([
      { id: 'txn-1', category: 'category-2' },
    ]);
  });

  it('verifies reversed ID-less split children through the update readback path', async () => {
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({
      data: [
        {
          id: 'txn-1',
          is_parent: true,
          account: 'source',
          amount: -1000,
          category: null,
          subtransactions: [
            { id: 'b', parent_id: 'txn-1', account: 'source', amount: -600, category: 'cat', payee: 'bank' },
            { id: 'a', parent_id: 'txn-1', account: 'source', amount: -400, category: 'cat', payee: 'bank' },
          ],
        },
      ],
    } as never);
    await expect(
      updateTransaction('txn-1', {
        subtransactions: [
          { amount: '-4', category: 'cat', payee: 'bank' },
          { amount: '-6', category: 'cat', payee: 'bank' },
        ],
      })
    ).resolves.toHaveLength(1);
  });

  it('reports observed state after an actual mismatch without attempting rollback', async () => {
    vi.useRealTimers();
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({ data: [{ id: 'txn-1', amount: -500 }] } as never);
    await expect(updateTransaction('txn-1', { amount: '-6' })).rejects.toThrow(
      '"observed":{"id":"txn-1","amount":-500}'
    );
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports unknown state if readback fails after mutation', async () => {
    vi.useRealTimers();
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.aqlQuery)
      .mockResolvedValueOnce({ data: [{ id: 'txn-1', amount: -500 }] } as never)
      .mockRejectedValue(new Error('read unavailable'));
    await expect(updateTransaction('txn-1', { amount: '-6' })).rejects.toThrow('"state":"unknown","retrySafe":false');
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
  });

  it('still rejects a correct source update when the old native counterpart survives', async () => {
    vi.useRealTimers();
    const before = {
      id: 'txn-1',
      account: 'source',
      amount: -76489,
      payee: 'transfer',
      transfer_id: 'old-counterpart',
      notes: 'SPŁATA ODSETEK',
      date: '2025-04-08',
      is_parent: false,
      subtransactions: [],
    };
    const observed = { ...before, payee: 'bank', category: 'mortgage', transfer_id: null };
    const counterpart = {
      id: 'old-counterpart',
      account: 'destination',
      amount: 76489,
      payee: 'source-payee',
      transfer_id: 'txn-1',
      date: '2025-04-08',
      notes: 'SPŁATA ODSETEK',
    };
    let mutated = false;
    let queryId: string;
    const query = {
      filter: vi.fn((filter: { id: string }) => {
        queryId = filter.id;
        return query;
      }),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.getPayees).mockResolvedValueOnce([
      { id: 'bank' },
      { id: 'transfer', transfer_acct: 'destination' },
      { id: 'source-payee', transfer_acct: 'source' },
    ] as never);
    vi.mocked(api.aqlQuery).mockImplementation(async () => ({
      data: queryId === 'old-counterpart' ? [counterpart] : [mutated ? observed : before],
    }));
    vi.mocked(api.updateTransaction).mockImplementationOnce(async () => {
      mutated = true;
      return undefined as never;
    });
    const result = await updateTransaction('txn-1', {
      payee: 'bank',
      category: 'mortgage',
      notes: 'SPŁATA ODSETEK',
    }).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    const message = (result as Error).message;
    expect(message).toContain('TRANSACTION_UPDATE_READBACK_MISMATCH');
    expect(message).toContain('"rollbackPerformed":false');
    expect(message).toContain('"observed":' + JSON.stringify(observed));
    expect(message).toContain(
      '"counterpartStates":[{"id":"old-counterpart","transaction":' + JSON.stringify(counterpart) + '}]'
    );
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid split totals before writing', async () => {
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({ data: [{ id: 'txn-1', amount: -1000 }] } as never);
    await expect(updateTransaction('txn-1', { subtransactions: [{ amount: '-4' }] })).rejects.toThrow(
      'SPLIT_TOTAL_MISMATCH'
    );
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('clears the parent category and verifies child payees on a split update', async () => {
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
    vi.mocked(api.updateTransaction).mockResolvedValue(undefined as never);
    vi.mocked(api.aqlQuery).mockResolvedValue({
      data: [
        {
          id: 'txn-1',
          is_parent: true,
          account: 'account-1',
          amount: -1000,
          category: null,
          subtransactions: [
            {
              id: 'child-a',
              parent_id: 'txn-1',
              account: 'account-1',
              amount: -400,
              category: 'shared-category',
              payee: 'payee-a',
            },
            {
              id: 'child-b',
              parent_id: 'txn-1',
              account: 'account-1',
              amount: -600,
              category: 'shared-category',
              payee: 'payee-b',
            },
          ],
        },
      ],
    } as never);

    await expect(
      updateTransaction('txn-1', {
        subtransactions: [
          { id: 'child-a', amount: '-4.00', category: 'shared-category', payee: 'payee-a' },
          { id: 'child-b', amount: '-6.00', category: 'shared-category', payee: 'payee-b' },
        ],
      })
    ).resolves.toHaveLength(1);

    expect(api.updateTransaction).toHaveBeenCalledWith('txn-1', {
      category: null,
      subtransactions: [
        { id: 'child-a', amount: -400, category: 'shared-category', payee: 'payee-a' },
        { id: 'child-b', amount: -600, category: 'shared-category', payee: 'payee-b' },
      ],
    });
  });
});

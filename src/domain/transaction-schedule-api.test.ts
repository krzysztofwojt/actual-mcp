import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actual-app/api', () => ({
  aqlQuery: vi.fn(),
  q: vi.fn(),
  updateTransaction: vi.fn(),
}));
vi.mock('../actual-api.js', () => ({ initActualApi: vi.fn() }));

import * as api from '@actual-app/api';
import { getTransactionById, setTransactionSchedule } from './transaction-schedule-api.js';

const transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  account: 'account-1',
  date: '2026-08-25',
  amount: -1234,
  payee: 'payee-1',
  category: 'category-1',
  notes: 'unchanged',
  cleared: true,
};

describe('transaction schedule API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = {
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      options: vi.fn().mockReturnThis(),
    };
    vi.mocked(api.q).mockReturnValue(query as never);
  });

  it('reads one transaction by exact UUID', async () => {
    vi.mocked(api.aqlQuery).mockResolvedValue({ data: [transaction] });

    await expect(getTransactionById(transaction.id)).resolves.toEqual(transaction);
    expect(api.q).toHaveBeenCalledWith('transactions');
  });

  it('sets the native schedule field and verifies protected fields', async () => {
    vi.mocked(api.aqlQuery)
      .mockResolvedValueOnce({ data: [{ ...transaction, schedule: null }] })
      .mockResolvedValueOnce({ data: [{ ...transaction, schedule: 'schedule-1' }] });

    await expect(setTransactionSchedule(transaction, 'schedule-1')).resolves.toMatchObject({
      id: transaction.id,
      schedule: 'schedule-1',
    });
    expect(api.updateTransaction).toHaveBeenCalledWith(transaction.id, { schedule: 'schedule-1' });
  });

  it('clears the native schedule field with null', async () => {
    vi.mocked(api.aqlQuery).mockResolvedValue({ data: [{ ...transaction, schedule: null }] });

    await expect(setTransactionSchedule({ ...transaction, schedule: 'schedule-1' }, null)).resolves.toMatchObject({
      id: transaction.id,
      schedule: null,
    });
    expect(api.updateTransaction).toHaveBeenCalledWith(transaction.id, { schedule: null });
  });

  it('fails when readback does not contain the requested schedule', async () => {
    vi.mocked(api.aqlQuery).mockResolvedValue({ data: [{ ...transaction, schedule: null }] });

    await expect(setTransactionSchedule(transaction, 'schedule-1')).rejects.toThrow(
      'TRANSACTION_SCHEDULE_READBACK_MISMATCH'
    );
  });

  it('fails if a protected transaction field changed', async () => {
    vi.mocked(api.aqlQuery).mockResolvedValue({
      data: [{ ...transaction, schedule: 'schedule-1', amount: -9999 }],
    });

    await expect(setTransactionSchedule(transaction, 'schedule-1')).rejects.toThrow('TRANSACTION_SCHEDULE_SIDE_EFFECT');
  });
});

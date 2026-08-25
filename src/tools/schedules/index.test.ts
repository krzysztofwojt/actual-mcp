import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleReadTools, scheduleWriteTools } from './index.js';

vi.mock('../../actual-api.js', () => ({ getAccounts: vi.fn(), getPayees: vi.fn() }));
vi.mock('../../domain/schedule-api.js', () => ({
  getSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

import { getAccounts, getPayees } from '../../actual-api.js';
import * as scheduleApi from '../../domain/schedule-api.js';

function handler(name: string): (typeof scheduleWriteTools)[number]['handler'] {
  return [...scheduleReadTools, ...scheduleWriteTools].find((tool) => tool.schema.name === name)!.handler;
}

describe('schedule tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccounts).mockResolvedValue([{ id: 'a1', name: 'Checking' }]);
    vi.mocked(getPayees).mockResolvedValue([{ id: 'p1', name: 'Rent' }]);
  });

  it('registers read and CRUD schedule tools', () => {
    expect([...scheduleReadTools, ...scheduleWriteTools].map((tool) => tool.schema.name)).toEqual([
      'get-schedules',
      'create-schedule',
      'update-schedule',
      'delete-schedule',
    ]);
  });

  it('creates a schedule with exact amount conversion and verifies it', async () => {
    vi.mocked(scheduleApi.createSchedule).mockResolvedValue('s1');
    vi.mocked(scheduleApi.getSchedules).mockResolvedValue([
      {
        id: 's1',
        name: 'Rent',
        account: 'a1',
        payee: 'p1',
        amount: -250000,
        amountOp: 'is',
        date: '2026-09-01',
        posts_transaction: true,
      },
    ]);
    const result = await handler('create-schedule')({
      name: 'Rent',
      account: 'checking',
      payee: 'rent',
      date: '2026-09-01',
      amount: '-2500.00',
      amountOp: 'is',
      postsTransaction: true,
    } as never);
    expect(scheduleApi.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'a1', payee: 'p1', amount: -250000 })
    );
    expect(result.isError).toBeUndefined();
  });

  it('requires the second amount for a between schedule', async () => {
    const result = await handler('create-schedule')({
      name: 'Variable',
      account: 'a1',
      payee: 'p1',
      date: '2026-09-01',
      amount: '-10.00',
      amountOp: 'isbetween',
      postsTransaction: false,
    } as never);
    expect(result.isError).toBe(true);
  });

  it('does not reset the next date for a metadata-only update', async () => {
    vi.mocked(scheduleApi.getSchedules).mockResolvedValue([
      { id: 's1', name: 'Rent', amountOp: 'is', date: '2026-09-01', posts_transaction: false },
    ]);
    vi.mocked(scheduleApi.updateSchedule).mockResolvedValue('s1');

    const result = await handler('update-schedule')({ schedule: 's1', name: 'New rent name' } as never);

    expect(scheduleApi.updateSchedule).toHaveBeenCalledWith('s1', { name: 'New rent name' }, false);
    expect(result.isError).toBeUndefined();
  });

  it('resets the next date when the schedule date changes', async () => {
    vi.mocked(scheduleApi.getSchedules).mockResolvedValue([
      { id: 's1', name: 'Rent', amountOp: 'is', date: '2026-09-01', posts_transaction: false },
    ]);
    vi.mocked(scheduleApi.updateSchedule).mockResolvedValue('s1');

    await handler('update-schedule')({ schedule: 's1', date: '2026-10-01' } as never);

    expect(scheduleApi.updateSchedule).toHaveBeenCalledWith('s1', { date: '2026-10-01' }, true);
  });

  it('honours an explicit resetNextDate override', async () => {
    vi.mocked(scheduleApi.getSchedules).mockResolvedValue([
      { id: 's1', name: 'Rent', amountOp: 'is', date: '2026-09-01', posts_transaction: false },
    ]);
    vi.mocked(scheduleApi.updateSchedule).mockResolvedValue('s1');

    await handler('update-schedule')({ schedule: 's1', date: '2026-10-01', resetNextDate: false } as never);

    expect(scheduleApi.updateSchedule).toHaveBeenCalledWith('s1', { date: '2026-10-01' }, false);
  });
});

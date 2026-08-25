import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actual-app/api', () => ({ default: { getAccountBalance: vi.fn() } }));

import api from '@actual-app/api';
import { fetchCurrentAccountBalance } from './account-balance.js';

describe('fetchCurrentAccountBalance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    vi.mocked(api.getAccountBalance).mockResolvedValue(1234);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses the current date instead of a far-future sentinel', async () => {
    await expect(fetchCurrentAccountBalance('acc-1')).resolves.toBe(1234);
    expect(api.getAccountBalance).toHaveBeenCalledWith('acc-1', new Date('2026-08-25T12:00:00.000Z'));
  });
});

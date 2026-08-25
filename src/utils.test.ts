import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDateRange } from './utils.js';

describe('getDateRange reporting defaults', () => {
  afterEach(() => vi.useRealTimers());

  it('uses a three-month recent period when both bounds are omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    expect(getDateRange()).toEqual({ startDate: '2026-05-25', endDate: '2026-08-25' });
  });

  it('anchors the default start three months before an explicit end date', () => {
    expect(getDateRange(undefined, '2025-04-15')).toEqual({
      startDate: '2025-01-15',
      endDate: '2025-04-15',
    });
  });
});

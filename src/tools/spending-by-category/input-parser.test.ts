import { describe, expect, it } from 'vitest';
import { SpendingByCategoryInputParser } from './input-parser.js';

describe('SpendingByCategoryInputParser', () => {
  it('uses unbounded dates and excludes income by default', () => {
    expect(new SpendingByCategoryInputParser().parse({})).toEqual({
      startDate: undefined,
      endDate: undefined,
      accountId: undefined,
      includeIncome: false,
    });
  });

  it('accepts each date bound independently', () => {
    expect(new SpendingByCategoryInputParser().parse({ endDate: '2026-05-24' })).toEqual({
      endDate: '2026-05-24',
      includeIncome: false,
    });
  });

  it('rejects an invalid date format', () => {
    expect(() => new SpendingByCategoryInputParser().parse({ startDate: '2026-5-1' })).toThrow();
  });
});

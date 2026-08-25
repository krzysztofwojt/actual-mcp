import { describe, expect, it } from 'vitest';
import { BalanceHistoryInputParser } from './input-parser.js';

describe('BalanceHistoryInputParser', () => {
  it('uses the published defaults for an aggregate report', () => {
    expect(new BalanceHistoryInputParser().parse({})).toEqual({
      accountId: undefined,
      includeOffBudget: false,
      months: 3,
    });
  });

  it('preserves an explicit account and off-budget scope', () => {
    expect(new BalanceHistoryInputParser().parse({ accountId: 'acc-1', includeOffBudget: true, months: 6 })).toEqual({
      accountId: 'acc-1',
      includeOffBudget: true,
      months: 6,
    });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects invalid months: %s', (months) => {
    expect(() => new BalanceHistoryInputParser().parse({ months })).toThrow();
  });
});

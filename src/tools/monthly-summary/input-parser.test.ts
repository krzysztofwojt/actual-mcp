import { describe, expect, it } from 'vitest';
import { MonthlySummaryInputParser } from './input-parser.js';

describe('MonthlySummaryInputParser', () => {
  it('uses the documented three-month default', () => {
    expect(new MonthlySummaryInputParser().parse({})).toEqual({ months: 3, accountId: undefined });
  });

  it('accepts an explicit positive integer month count', () => {
    expect(new MonthlySummaryInputParser().parse({ months: 6, accountId: 'acc-1' })).toEqual({
      months: 6,
      accountId: 'acc-1',
    });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects invalid months: %s', (months) => {
    expect(() => new MonthlySummaryInputParser().parse({ months })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money.js';

describe('money contract', () => {
  it('converts exact decimal strings to minor units and back', () => {
    expect(parseMoney('123.45')).toBe(12345);
    expect(parseMoney('-19.9')).toBe(-1990);
    expect(formatMoney(-1990)).toBe('-19.90');
  });

  it('accepts boundary decimal forms without floating point arithmetic', () => {
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('0.01')).toBe(1);
  });

  it('rejects ambiguous numeric formatting', () => {
    expect(() => parseMoney('1.234')).toThrow('INVALID_AMOUNT');
    expect(() => parseMoney('01.00')).toThrow('INVALID_AMOUNT');
  });
});

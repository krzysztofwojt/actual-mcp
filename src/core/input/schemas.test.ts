import { describe, expect, it } from 'vitest';
import { AccountReferenceSchema, DateSchema, PositiveIntegerSchema } from './schemas.js';

describe('shared input schemas', () => {
  it('accepts canonical account references, dates, and positive integers', () => {
    expect(AccountReferenceSchema.parse('account-1')).toBe('account-1');
    expect(DateSchema.parse('2026-08-25')).toBe('2026-08-25');
    expect(PositiveIntegerSchema.parse(3)).toBe(3);
  });

  it.each(['', '   '])('rejects an empty account reference: %j', (value) => {
    expect(() => AccountReferenceSchema.parse(value)).toThrow();
  });

  it.each(['2026-8-25', '25-08-2026'])('rejects a non-canonical date: %s', (value) => {
    expect(() => DateSchema.parse(value)).toThrow();
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects an invalid positive integer: %s', (value) => {
    expect(() => PositiveIntegerSchema.parse(value)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { assertSplitTotal, hasPayeeReferences, resolveTransactionPayees } from './transaction-payees.js';

const payees = [
  { id: 'payee-a', name: 'Shop A' },
  { id: 'payee-b', name: 'Shop B' },
];

describe('transaction payee input', () => {
  it('resolves distinct child payees by id and unique case-insensitive name', () => {
    const transaction = {
      amount: '-10.00',
      subtransactions: [
        { amount: '-4.00', category: 'shared-category', payee: 'payee-a' },
        { amount: '-6.00', category: 'shared-category', payee: 'shop b' },
      ],
    };

    resolveTransactionPayees(transaction, payees);

    expect(transaction.subtransactions.map((item) => item.payee)).toEqual(['payee-a', 'payee-b']);
  });

  it('fails closed for an unknown child payee', () => {
    const transaction = { subtransactions: [{ amount: '-10.00', payee: 'Missing' }] };
    expect(() => resolveTransactionPayees(transaction, payees)).toThrow('UNKNOWN_PAYEE');
  });

  it('detects payee references only when lookup is required', () => {
    expect(hasPayeeReferences({ subtransactions: [{ amount: '-10.00' }] })).toBe(false);
    expect(hasPayeeReferences({ subtransactions: [{ amount: '-10.00', payee: 'Shop A' }] })).toBe(true);
  });

  it('accepts an exact split total and rejects a mismatch', () => {
    expect(() => assertSplitTotal('-10.00', [{ amount: '-4.00' }, { amount: '-6.00' }])).not.toThrow();
    expect(() => assertSplitTotal('-10.00', [{ amount: '-4.00' }, { amount: '-5.00' }])).toThrow(
      'SPLIT_TOTAL_MISMATCH'
    );
  });
});

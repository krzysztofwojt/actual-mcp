import { describe, expect, it } from 'vitest';
import { resolveEntity } from './entity-resolver.js';

const entities = [
  { id: 'one', name: 'Groceries' },
  { id: 'two', name: 'Rent' },
];

describe('resolveEntity', () => {
  it('resolves exact ids and unique names', () => {
    expect(resolveEntity('one', entities, (item) => item.name, 'category').id).toBe('one');
    expect(resolveEntity('groceries', entities, (item) => item.name, 'category').id).toBe('one');
  });

  it('rejects ambiguous names', () => {
    expect(() =>
      resolveEntity('rent', [...entities, { id: 'three', name: 'RENT' }], (item) => item.name, 'category')
    ).toThrow('AMBIGUOUS_CATEGORY');
  });

  it('rejects unknown references without fuzzy matching', () => {
    expect(() => resolveEntity('rents', entities, (item) => item.name, 'category')).toThrow('UNKNOWN_CATEGORY');
  });
});

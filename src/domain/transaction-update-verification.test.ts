import { describe, expect, it } from 'vitest';
import {
  transactionContainsUpdate,
  verifySplitTransfers,
  verifyTransactionTransfers,
  nativeCategoryMayBeCleared,
} from './transaction-update-verification.js';

const children = [
  {
    id: 'capital',
    parent_id: 'parent',
    account: 'source',
    date: '2024-10-28',
    amount: -89161,
    category: 'mortgage',
    payee: 'transfer',
    notes: 'Kapitał',
    transfer_id: 'counterpart',
  },
  {
    id: 'interest',
    parent_id: 'parent',
    account: 'source',
    date: '2024-10-28',
    amount: -190848,
    category: 'mortgage',
    payee: 'bank',
    notes: 'Odsetki',
    transfer_id: null,
  },
];
const parent = {
  id: 'parent',
  account: 'source',
  is_parent: true,
  amount: -280009,
  category: null,
  transfer_id: null,
  subtransactions: children,
};
const payees = [
  { id: 'transfer', transfer_acct: 'destination' },
  { id: 'source-payee', transfer_acct: 'source' },
  { id: 'bank', transfer_acct: null },
];
const counterpart = {
  id: 'counterpart',
  account: 'destination',
  payee: 'source-payee',
  date: '2024-10-28',
  amount: 89161,
  notes: 'Kapitał',
  transfer_id: 'capital',
};

it('matches reversed ID-less children without conflating counterpart and child IDs', () => {
  expect(
    transactionContainsUpdate(
      { ...parent, subtransactions: [...children].reverse() },
      {
        category: null,
        subtransactions: children.map(({ amount, category, payee, notes }) => ({ amount, category, payee, notes })),
      }
    )
  ).toBe(true);
});

it('consumes duplicate children once and prioritizes explicit IDs', () => {
  expect(
    transactionContainsUpdate(
      {
        subtransactions: [
          { id: 'a', amount: 1 },
          { id: 'b', amount: 1 },
        ],
      },
      { subtransactions: [{ amount: 1 }, { id: 'a', amount: 1 }] }
    )
  ).toBe(true);
  expect(
    transactionContainsUpdate(
      { subtransactions: [{ amount: 1 }, { amount: 2 }] },
      { subtransactions: [{ amount: 1 }, { amount: 1 }] }
    )
  ).toBe(false);
  expect(transactionContainsUpdate(parent, { subtransactions: [{ ...children[0], id: 'other' }, children[1]] })).toBe(
    false
  );
});

it('accepts a native transfer child under a parent with no transfer_id', async () => {
  expect(await verifySplitTransfers(parent, payees, async () => counterpart)).toEqual({
    matches: true,
    counterparts: [counterpart],
  });
});

describe('rejects invalid native counterparts', () => {
  it.each([
    { account: 'wrong' },
    { amount: 190848 },
    { transfer_id: 'interest' },
    { payee: 'bank' },
    { notes: 'Odsetki' },
    { date: '2024-10-29' },
    { id: 'capital' },
  ])('rejects %j', async (fields) => {
    expect((await verifySplitTransfers(parent, payees, async () => ({ ...counterpart, ...fields }))).matches).toBe(
      false
    );
  });
  it('rejects a missing counterpart', async () => {
    expect((await verifySplitTransfers(parent, payees, async () => undefined)).matches).toBe(false);
  });
  it('rejects an interest counterpart, wrong sum and a child on another parent', async () => {
    for (const changed of [
      { ...parent, subtransactions: [children[0], { ...children[1], transfer_id: 'interest-counterpart' }] },
      { ...parent, amount: -1 },
      { ...parent, subtransactions: [{ ...children[0], parent_id: 'other' }, children[1]] },
    ])
      expect((await verifySplitTransfers(changed, payees, async () => counterpart)).matches).toBe(false);
  });
});

it('matches overlapping partial child requests without greedy false mismatches', () => {
  expect(
    transactionContainsUpdate(
      {
        subtransactions: [
          { amount: -1, payee: 'a' },
          { amount: -1, payee: 'b' },
        ],
      },
      { subtransactions: [{ amount: -1 }, { amount: -1, payee: 'a' }] }
    )
  ).toBe(true);
});

it('permits native category clearing only for eligible source/destination accounts', () => {
  const accounts = [
    { id: 'source', offbudget: false },
    { id: 'destination', offbudget: true },
  ];
  const update = { subtransactions: children.map(({ amount, category, payee }) => ({ amount, category, payee })) };
  const cleared = { ...parent, subtransactions: [{ ...children[0], category: null }, children[1]] };
  expect(transactionContainsUpdate(cleared, update, nativeCategoryMayBeCleared('source', accounts, payees))).toBe(
    false
  );
  accounts[1].offbudget = false;
  const canClear = nativeCategoryMayBeCleared('source', accounts, payees);
  expect(transactionContainsUpdate(cleared, update, canClear)).toBe(true);
  expect(
    transactionContainsUpdate(
      { ...parent, subtransactions: [children[0], { ...children[1], category: null }] },
      update,
      canClear
    )
  ).toBe(false);
  expect(
    transactionContainsUpdate(
      { ...parent, subtransactions: [{ ...children[0], category: 'wrong' }, children[1]] },
      update,
      canClear
    )
  ).toBe(false);
});

const standaloneBefore = {
  id: 'source-transaction',
  account: 'source',
  amount: -89161,
  payee: 'transfer',
  category: 'mortgage',
  notes: 'Kapitał',
  date: '2024-10-28',
  transfer_id: 'old-counterpart',
  is_parent: false,
  subtransactions: [],
};
const standaloneNormal = { ...standaloneBefore, payee: 'bank', transfer_id: null };
const standaloneCounterpart = { ...counterpart, id: 'old-counterpart', transfer_id: 'source-transaction' };

it('accepts empty grouped children for a standalone transaction but rejects empty split parents', async () => {
  expect((await verifySplitTransfers(standaloneNormal, payees, async () => undefined)).matches).toBe(true);
  expect(
    (await verifySplitTransfers({ ...standaloneNormal, is_parent: true }, payees, async () => undefined)).matches
  ).toBe(false);
});

it('accepts unlinking a standalone transfer only when its old counterpart disappears', async () => {
  const result = await verifyTransactionTransfers(standaloneBefore, standaloneNormal, payees, async () => undefined);
  expect(result.matches).toBe(true);
  expect(result.counterpartStates).toEqual([{ id: 'old-counterpart', transaction: null }]);
  for (const stale of [standaloneCounterpart, { ...standaloneCounterpart, transfer_id: null, payee: null }]) {
    const failed = await verifyTransactionTransfers(standaloneBefore, standaloneNormal, payees, async () => stale);
    expect(failed.matches).toBe(false);
    expect(failed.counterparts).toEqual([stale]);
  }
});

it('accepts native detachment of a counterpart child without deleting the other split', async () => {
  const detachedChild = {
    ...standaloneCounterpart,
    is_child: true,
    parent_id: 'other-parent',
    transfer_id: null,
    payee: null,
  };
  expect(
    (await verifyTransactionTransfers(standaloneBefore, standaloneNormal, payees, async () => detachedChild)).matches
  ).toBe(true);
  expect(
    (
      await verifyTransactionTransfers(standaloneBefore, standaloneNormal, payees, async () => ({
        ...detachedChild,
        payee: 'source-payee',
      }))
    ).matches
  ).toBe(false);
});

it('verifies standalone native transfers, including inverse amounts and reciprocal links', async () => {
  expect(
    (await verifyTransactionTransfers(standaloneNormal, standaloneBefore, payees, async () => standaloneCounterpart))
      .matches
  ).toBe(true);
  for (const failed of [
    undefined,
    { ...standaloneCounterpart, amount: 190848 },
    { ...standaloneCounterpart, transfer_id: 'wrong' },
    { ...standaloneCounterpart, account: 'wrong' },
  ]) {
    expect(
      (await verifyTransactionTransfers(standaloneNormal, standaloneBefore, payees, async () => failed)).matches
    ).toBe(false);
  }
  expect(
    (
      await verifyTransactionTransfers(
        standaloneNormal,
        { ...standaloneBefore, transfer_id: null },
        payees,
        async () => standaloneCounterpart
      )
    ).matches
  ).toBe(false);
  expect(
    (
      await verifyTransactionTransfers(
        standaloneBefore,
        { ...standaloneNormal, transfer_id: 'old-counterpart' },
        payees,
        async () => standaloneCounterpart
      )
    ).matches
  ).toBe(false);
});

it('does not mask incorrect payee, category, notes or amounts on standalone transactions', () => {
  const request = { payee: 'bank', category: 'mortgage', notes: 'Kapitał', amount: -89161 };
  expect(transactionContainsUpdate(standaloneNormal, request)).toBe(true);
  for (const bad of [{ payee: 'transfer' }, { category: 'wrong' }, { notes: 'wrong' }, { amount: -1 }]) {
    expect(transactionContainsUpdate({ ...standaloneNormal, ...bad }, request)).toBe(false);
  }
});

it('uses the native category policy for standalone transfers as well as split children', () => {
  const accounts = [
    { id: 'source', offbudget: false },
    { id: 'destination', offbudget: false },
  ];
  const canClear = nativeCategoryMayBeCleared('source', accounts, payees);
  expect(transactionContainsUpdate({ ...standaloneBefore, category: null }, { category: 'mortgage' }, canClear)).toBe(
    true
  );
  expect(transactionContainsUpdate({ ...standaloneNormal, category: null }, { category: 'mortgage' }, canClear)).toBe(
    false
  );
});

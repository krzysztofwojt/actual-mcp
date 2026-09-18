export type TransactionRecord = Record<string, unknown>;

/** Match children as a multiset: native sorting is not request ordering. */
export function transactionContainsUpdate(
  stored: TransactionRecord,
  update: TransactionRecord,
  categoryMayBeCleared: (child: TransactionRecord) => boolean = () => false
): boolean {
  return Object.entries(update).every(([field, expected]) => {
    if (expected === undefined) return true;
    if (field !== 'subtransactions') {
      return (
        stored[field] === expected || (field === 'category' && stored.category === null && categoryMayBeCleared(stored))
      );
    }
    if (!Array.isArray(expected) || !Array.isArray(stored[field]) || stored[field].length !== expected.length)
      return false;
    const children = stored[field] as TransactionRecord[];
    const owners = new Map<number, number>();
    // # Reason: bipartite matching handles partial fields and duplicates without
    // consuming a child needed by a more specific request record.
    const match = (requestIndex: number, visited: Set<number>): boolean => {
      const child = expected[requestIndex] as TransactionRecord;
      for (let index = 0; index < children.length; index += 1) {
        if (visited.has(index)) continue;
        const candidate = children[index];
        if (
          !Object.entries(child).every(
            ([key, value]) =>
              value === undefined ||
              candidate[key] === value ||
              (key === 'category' && candidate.category === null && categoryMayBeCleared(candidate))
          )
        )
          continue;
        visited.add(index);
        const owner = owners.get(index);
        if (owner === undefined || match(owner, visited)) {
          owners.set(index, requestIndex);
          return true;
        }
      }
      return false;
    };
    return expected.every((_, index) => match(index, new Set()));
  });
}

interface TransferPayee {
  id: string;
  transfer_acct?: string | null;
}

interface TransferVerification {
  matches: boolean;
  counterparts: TransactionRecord[];
}

type ReadTransaction = (id: string) => Promise<TransactionRecord | undefined>;

/** Verify native reciprocal links; counterpart IDs are not source transaction IDs. */
async function verifyTransferRecord(
  transaction: TransactionRecord,
  payees: TransferPayee[],
  read: ReadTransaction,
  counterparts: TransactionRecord[]
): Promise<boolean> {
  const destination = payees.find((payee) => payee.id === transaction.payee)?.transfer_acct;
  if (!destination) return transaction.transfer_id == null;
  const counterpart = typeof transaction.transfer_id === 'string' ? await read(transaction.transfer_id) : undefined;
  if (counterpart) counterparts.push(counterpart);
  const sourcePayee = payees.find((payee) => payee.transfer_acct === transaction.account)?.id;
  return Boolean(
    counterpart &&
    counterpart.id !== transaction.id &&
    counterpart.is_parent !== true &&
    counterpart.account === destination &&
    counterpart.transfer_id === transaction.id &&
    counterpart.amount === -Number(transaction.amount) &&
    counterpart.date === transaction.date &&
    counterpart.notes === transaction.notes &&
    counterpart.payee === sourcePayee
  );
}

/** Empty grouped children do not turn a standalone transaction into a split. */
export async function verifySplitTransfers(
  parent: TransactionRecord,
  payees: TransferPayee[],
  read: ReadTransaction
): Promise<TransferVerification> {
  const counterparts: TransactionRecord[] = [];
  const children = Array.isArray(parent.subtransactions) ? (parent.subtransactions as TransactionRecord[]) : [];
  if (parent.is_parent !== true) return { matches: children.length === 0, counterparts };
  let matches = children.length > 0 && children.reduce((sum, child) => sum + Number(child.amount), 0) === parent.amount;
  for (const child of children) {
    if (child.parent_id !== parent.id || child.account !== parent.account) matches = false;
    if (!(await verifyTransferRecord(child, payees, read, counterparts))) matches = false;
  }
  return { matches, counterparts };
}

export interface CounterpartState {
  id: string;
  transaction: TransactionRecord | null;
}

/** Reconcile current native transfers and counterparts unlinked by this update. */
export async function verifyTransactionTransfers(
  before: TransactionRecord | undefined,
  stored: TransactionRecord,
  payees: TransferPayee[],
  read: ReadTransaction
): Promise<TransferVerification & { counterpartStates: CounterpartState[] }> {
  const states = new Map<string, TransactionRecord | null>();
  const readCounterpart: ReadTransaction = async (id) => {
    if (!states.has(id)) states.set(id, (await read(id)) ?? null);
    return states.get(id) ?? undefined;
  };
  const children = Array.isArray(stored.subtransactions) ? (stored.subtransactions as TransactionRecord[]) : [];
  const isSplit = stored.is_parent === true || children.length > 0;
  const result = isSplit
    ? await verifySplitTransfers(stored, payees, readCounterpart)
    : {
        matches: await verifyTransferRecord(stored, payees, readCounterpart, []),
        counterparts: [],
      };
  const currentRows = isSplit ? children : [stored];
  const oldRows =
    before?.is_parent === true && Array.isArray(before.subtransactions)
      ? (before.subtransactions as TransactionRecord[])
      : before
        ? [before]
        : [];
  for (const oldRow of oldRows) {
    const id = oldRow.transfer_id;
    if (typeof id !== 'string' || currentRows.some((row) => row.transfer_id === id)) continue;
    const oldCounterpart = await readCounterpart(id);
    // # Reason: Actual deletes standalone counterparts, but detaches counterpart
    // children in place to preserve the other account's split parent and amount.
    if (
      oldCounterpart &&
      !(oldCounterpart.is_child === true && oldCounterpart.transfer_id == null && oldCounterpart.payee == null)
    ) {
      result.matches = false;
    }
  }
  return {
    matches: result.matches,
    counterparts: [...states.values()].filter((row): row is TransactionRecord => row !== null),
    counterpartStates: [...states.entries()].map(([id, transaction]) => ({ id, transaction })),
  };
}

/** Native category clearing is permitted only by the source/destination account policy. */
export function nativeCategoryMayBeCleared(
  sourceId: unknown,
  accounts: Array<{ id: string; offbudget?: boolean }>,
  payees: TransferPayee[]
): (child: TransactionRecord) => boolean {
  const source = accounts.find((account) => account.id === sourceId);
  return (child) => {
    if (!source) return false;
    if (source.offbudget) return true;
    const destinationId = payees.find((payee) => payee.id === child.payee)?.transfer_acct;
    const destination = accounts.find((account) => account.id === destinationId);
    return Boolean(destination && Boolean(destination.offbudget) === Boolean(source.offbudget));
  };
}

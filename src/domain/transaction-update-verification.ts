export type TransactionRecord = Record<string, unknown>;

/** Match children as a multiset: native sorting is not request ordering. */
export function transactionContainsUpdate(
  stored: TransactionRecord,
  update: TransactionRecord,
  categoryMayBeCleared: (child: TransactionRecord) => boolean = () => false
): boolean {
  return Object.entries(update).every(([field, expected]) => {
    if (expected === undefined) return true;
    if (field !== 'subtransactions') return stored[field] === expected;
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

/** Verify native reciprocal links; counterpart IDs are not source child IDs. */
export async function verifySplitTransfers(
  parent: TransactionRecord,
  payees: TransferPayee[],
  read: (id: string) => Promise<TransactionRecord | undefined>
): Promise<{ matches: boolean; counterparts: TransactionRecord[] }> {
  const counterparts: TransactionRecord[] = [];
  if (!Array.isArray(parent.subtransactions)) return { matches: true, counterparts };
  const children = parent.subtransactions as TransactionRecord[];
  let matches =
    parent.is_parent === true && children.reduce((sum, child) => sum + Number(child.amount), 0) === parent.amount;
  for (const child of children) {
    const destination = payees.find((payee) => payee.id === child.payee)?.transfer_acct;
    if (child.parent_id !== parent.id || child.account !== parent.account) matches = false;
    if (!destination) {
      if (child.transfer_id) matches = false;
      continue;
    }
    const counterpart = typeof child.transfer_id === 'string' ? await read(child.transfer_id) : undefined;
    if (counterpart) counterparts.push(counterpart);
    const sourcePayee = payees.find((payee) => payee.transfer_acct === parent.account)?.id;
    if (
      !counterpart ||
      counterpart.id === child.id ||
      counterpart.account !== destination ||
      counterpart.transfer_id !== child.id ||
      counterpart.amount !== -Number(child.amount) ||
      counterpart.date !== child.date ||
      counterpart.notes !== child.notes ||
      counterpart.payee !== sourcePayee
    ) {
      matches = false;
    }
  }
  return { matches, counterparts };
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

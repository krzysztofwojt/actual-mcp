import api from '@actual-app/api';

/** Fetch the account balance as of now, excluding transactions dated in the future. */
export async function fetchCurrentAccountBalance(accountId: string, now: Date = new Date()): Promise<number> {
  return api.getAccountBalance(accountId, now);
}

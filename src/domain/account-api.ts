import * as api from '@actual-app/api';
import { APIAccountEntity } from '@actual-app/api/models';
import { initActualApi } from '../actual-api.js';
import { fetchCurrentAccountBalance } from '../core/data/account-balance.js';

export async function createAccount(
  fields: Omit<APIAccountEntity, 'id' | 'balance_current'>,
  initialBalance: number
): Promise<string> {
  await initActualApi();
  return api.createAccount(fields, initialBalance);
}

export async function updateAccount(id: string, fields: Partial<APIAccountEntity>): Promise<void> {
  await initActualApi();
  await api.updateAccount(id, fields);
}

export async function closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void> {
  await initActualApi();
  await api.closeAccount(id, transferAccountId, transferCategoryId);
}

export async function reopenAccount(id: string): Promise<void> {
  await initActualApi();
  await api.reopenAccount(id);
}

export async function deleteAccount(id: string): Promise<void> {
  await initActualApi();
  await api.deleteAccount(id);
}

export async function getAccountBalance(id: string): Promise<number> {
  await initActualApi();
  return fetchCurrentAccountBalance(id);
}

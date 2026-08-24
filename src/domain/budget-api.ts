import * as api from '@actual-app/api';
import { initActualApi } from '../actual-api.js';

export type BudgetMonth = Awaited<ReturnType<typeof api.getBudgetMonth>>;

export async function getBudgetMonth(month: string): Promise<BudgetMonth> {
  await initActualApi();
  return api.getBudgetMonth(month);
}

export async function setBudgetAmount(month: string, categoryId: string, amount: number): Promise<void> {
  await initActualApi();
  await api.setBudgetAmount(month, categoryId, amount);
}

export async function setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
  await initActualApi();
  await api.setBudgetCarryover(month, categoryId, flag);
}

export async function holdBudgetForNextMonth(month: string, amount: number): Promise<boolean> {
  await initActualApi();
  return api.holdBudgetForNextMonth(month, amount);
}

export async function resetBudgetHold(month: string): Promise<void> {
  await initActualApi();
  await api.resetBudgetHold(month);
}

export async function batchBudgetUpdates(operation: () => Promise<void>): Promise<void> {
  await initActualApi();
  await api.batchBudgetUpdates(operation);
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textContent } from '../../utils/response.js';
import { budgetReadTools, budgetWriteTools } from './index.js';

vi.mock('../../actual-api.js', () => ({
  getCategories: vi.fn(),
}));

vi.mock('../../domain/budget-api.js', () => ({
  getBudgetMonth: vi.fn(),
  setBudgetAmount: vi.fn(),
  setBudgetCarryover: vi.fn(),
  holdBudgetForNextMonth: vi.fn(),
  resetBudgetHold: vi.fn(),
  batchBudgetUpdates: vi.fn(async (operation: () => Promise<void>) => operation()),
}));

import { getCategories } from '../../actual-api.js';
import { getBudgetMonth, setBudgetAmount } from '../../domain/budget-api.js';
import type { BudgetMonth } from '../../domain/budget-api.js';

const setTool = budgetWriteTools.find((item) => item.schema.name === 'set-budget-amount')!;
const moveTool = budgetWriteTools.find((item) => item.schema.name === 'move-budget')!;
const strategyTool = budgetWriteTools.find((item) => item.schema.name === 'apply-budget-strategy')!;

function month(first = 1000, second = 2000): BudgetMonth {
  return {
    month: '2026-08',
    incomeAvailable: 0,
    lastMonthOverspent: 0,
    forNextMonth: 0,
    totalBudgeted: 3000,
    toBudget: 0,
    fromLastMonth: 0,
    totalIncome: 0,
    totalSpent: 0,
    totalBalance: 0,
    categoryGroups: [
      {
        categories: [
          { id: 'cat-1', budgeted: first },
          { id: 'cat-2', budgeted: second },
        ],
      },
    ],
  };
}

describe('budget tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCategories).mockResolvedValue([
      { id: 'cat-1', name: 'Food', group_id: 'group' },
      { id: 'cat-2', name: 'Rent', group_id: 'group' },
    ] as never);
  });

  it('registers one read tool and all requested write primitives', () => {
    expect(budgetReadTools.map((item) => item.schema.name)).toEqual(['get-budget-month']);
    expect(budgetWriteTools.map((item) => item.schema.name)).toContain('apply-budget-strategy');
  });

  it('sets and reads back an exact decimal budget amount', async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue(month(12345, 2000));
    const result = await setTool.handler({ month: '2026-08', category: 'food', amount: '123.45' } as never);

    expect(setBudgetAmount).toHaveBeenCalledWith('2026-08', 'cat-1', 12345);
    expect(result.isError).toBeUndefined();
    expect(textContent(result.content[0])).toContain('"amount":"123.45"');
  });

  it('rejects moving money to the same category', async () => {
    const result = await moveTool.handler({
      month: '2026-08',
      fromCategory: 'Food',
      toCategory: 'cat-1',
      amount: '10.00',
    } as never);
    expect(result.isError).toBe(true);
    expect(textContent(result.content[0])).toContain('MOVE_BUDGET_SAME_CATEGORY');
  });

  it('returns an MCP error when the API readback fails', async () => {
    vi.mocked(getBudgetMonth).mockRejectedValue(new Error('budget unavailable'));
    const result = await setTool.handler({ month: '2026-08', category: 'Food', amount: '1.00' } as never);
    expect(result.isError).toBe(true);
    expect(textContent(result.content[0])).toContain('budget unavailable');
  });

  it('requires an explicit dryRun choice before applying a budget strategy', async () => {
    const result = await strategyTool.handler({
      month: '2026-08',
      strategy: 'zero',
      categories: ['Food'],
    } as never);

    expect(result.isError).toBe(true);
    expect(setBudgetAmount).not.toHaveBeenCalled();
  });

  it('previews a budget strategy without writing when dryRun is true', async () => {
    const result = await strategyTool.handler({
      month: '2026-08',
      strategy: 'zero',
      categories: ['Food'],
      dryRun: true,
    } as never);

    expect(result.isError).toBeUndefined();
    expect(setBudgetAmount).not.toHaveBeenCalled();
  });
});

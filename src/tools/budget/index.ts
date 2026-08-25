import { z } from 'zod';
import { getCategories } from '../../actual-api.js';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import { formatMoney, parseMoney } from '../../core/input/money.js';
import {
  batchBudgetUpdates,
  getBudgetMonth,
  holdBudgetForNextMonth,
  resetBudgetHold,
  setBudgetAmount,
  setBudgetCarryover,
  BudgetMonth,
} from '../../domain/budget-api.js';
import { defineTool } from '../tool-factory.js';

const MonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');
const CategorySchema = z.string().min(1).describe('Exact category ID or unique category name');

async function category(reference: string): Promise<Awaited<ReturnType<typeof getCategories>>[number]> {
  return resolveEntity(reference, await getCategories(), (item) => String(item.name), 'category');
}

function categoryRows(month: BudgetMonth): Array<Record<string, unknown>> {
  return month.categoryGroups.flatMap((group) => (group.categories ?? []) as Array<Record<string, unknown>>);
}

function budgeted(month: BudgetMonth, categoryId: string): number {
  const row = categoryRows(month).find((item) => item.id === categoryId);
  if (!row || typeof row.budgeted !== 'number') throw new Error(`BUDGET_READBACK_MISSING: ${categoryId}`);
  return row.budgeted;
}

function previousMonth(month: string): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return date.toISOString().slice(0, 7);
}

const getBudgetMonthTool = defineTool(
  'get-budget-month',
  'Get the full envelope budget state for one month.',
  z.object({ month: MonthSchema }),
  async ({ month }) => getBudgetMonth(month)
);

const setBudgetAmountTool = defineTool(
  'set-budget-amount',
  'Set the absolute budgeted amount for one category and verify the stored value.',
  z.object({ month: MonthSchema, category: CategorySchema, amount: z.string() }),
  async ({ month, category: reference, amount }) => {
    const resolved = await category(reference);
    const amountMinor = parseMoney(amount);
    await setBudgetAmount(month, resolved.id, amountMinor);
    const stored = budgeted(await getBudgetMonth(month), resolved.id);
    if (stored !== amountMinor)
      throw new Error(`BUDGET_READBACK_MISMATCH: expected ${amountMinor}, received ${stored}`);
    return {
      month,
      category: { id: resolved.id, name: resolved.name },
      amount: formatMoney(stored),
      amountMinor: stored,
    };
  }
);

const moveBudgetTool = defineTool(
  'move-budget',
  'Atomically move budgeted money between two categories without changing the total.',
  z.object({ month: MonthSchema, fromCategory: CategorySchema, toCategory: CategorySchema, amount: z.string() }),
  async ({ month, fromCategory, toCategory, amount }) => {
    const [source, target] = await Promise.all([category(fromCategory), category(toCategory)]);
    if (source.id === target.id) throw new Error('MOVE_BUDGET_SAME_CATEGORY');
    const amountMinor = parseMoney(amount);
    if (amountMinor <= 0) throw new Error('MOVE_BUDGET_AMOUNT_MUST_BE_POSITIVE');
    const before = await getBudgetMonth(month);
    const sourceBefore = budgeted(before, source.id);
    const targetBefore = budgeted(before, target.id);
    await batchBudgetUpdates(async () => {
      await setBudgetAmount(month, source.id, sourceBefore - amountMinor);
      await setBudgetAmount(month, target.id, targetBefore + amountMinor);
    });
    const after = await getBudgetMonth(month);
    const sourceAfter = budgeted(after, source.id);
    const targetAfter = budgeted(after, target.id);
    if (sourceAfter + targetAfter !== sourceBefore + targetBefore) throw new Error('MOVE_BUDGET_TOTAL_MISMATCH');
    return {
      month,
      amount: formatMoney(amountMinor),
      amountMinor,
      from: { id: source.id, name: source.name, before: formatMoney(sourceBefore), after: formatMoney(sourceAfter) },
      to: { id: target.id, name: target.name, before: formatMoney(targetBefore), after: formatMoney(targetAfter) },
    };
  }
);

const setCarryoverTool = defineTool(
  'set-budget-carryover',
  'Enable or disable category balance carryover for a month.',
  z.object({ month: MonthSchema, category: CategorySchema, enabled: z.boolean() }),
  async ({ month, category: reference, enabled }) => {
    const resolved = await category(reference);
    await setBudgetCarryover(month, resolved.id, enabled);
    const stored = categoryRows(await getBudgetMonth(month)).find((item) => item.id === resolved.id);
    if (!stored || Boolean(stored.carryover) !== enabled) {
      throw new Error(`BUDGET_CARRYOVER_READBACK_MISMATCH: ${resolved.id}`);
    }
    return { month, category: { id: resolved.id, name: resolved.name }, enabled };
  }
);

const holdTool = defineTool(
  'hold-budget-for-next-month',
  'Hold part of To Budget for the next month.',
  z.object({ month: MonthSchema, amount: z.string() }),
  async ({ month, amount }) => {
    const amountMinor = parseMoney(amount);
    if (amountMinor < 0) throw new Error('HOLD_AMOUNT_MUST_NOT_BE_NEGATIVE');
    const changed = await holdBudgetForNextMonth(month, amountMinor);
    const stored = await getBudgetMonth(month);
    if (stored.forNextMonth !== amountMinor) {
      throw new Error(`BUDGET_HOLD_READBACK_MISMATCH: expected ${amountMinor}, received ${stored.forNextMonth}`);
    }
    return { month, amount: formatMoney(amountMinor), amountMinor, changed };
  }
);

const resetHoldTool = defineTool(
  'reset-budget-hold',
  'Reset the amount held for the next month.',
  z.object({ month: MonthSchema }),
  async ({ month }) => {
    await resetBudgetHold(month);
    const stored = await getBudgetMonth(month);
    if (stored.forNextMonth !== 0) throw new Error(`BUDGET_HOLD_RESET_READBACK_MISMATCH: ${stored.forNextMonth}`);
    return { month, reset: true };
  }
);

const strategyTool = defineTool(
  'apply-budget-strategy',
  'Apply zero or previous-month budgeting to selected categories as one batch.',
  z.object({
    month: MonthSchema,
    strategy: z.enum(['zero', 'copy-previous']),
    categories: z.array(CategorySchema).min(1),
    dryRun: z.boolean().describe('Required. Set true to preview changes or false to apply them.'),
  }),
  async ({ month, strategy, categories, dryRun }) => {
    const resolved = await Promise.all(categories.map(category));
    const source = strategy === 'copy-previous' ? await getBudgetMonth(previousMonth(month)) : null;
    const changes = resolved.map((item) => ({
      category: { id: item.id, name: item.name },
      amountMinor: source ? budgeted(source, item.id) : 0,
    }));
    if (!dryRun) {
      await batchBudgetUpdates(async () => {
        for (const change of changes) await setBudgetAmount(month, change.category.id, change.amountMinor);
      });
      const after = await getBudgetMonth(month);
      for (const change of changes) {
        if (budgeted(after, change.category.id) !== change.amountMinor)
          throw new Error('BUDGET_STRATEGY_READBACK_MISMATCH');
      }
    }
    return {
      month,
      strategy,
      dryRun,
      changes: changes.map((change) => ({ ...change, amount: formatMoney(change.amountMinor) })),
    };
  }
);

export const budgetReadTools = [getBudgetMonthTool];
export const budgetWriteTools = [
  setBudgetAmountTool,
  moveBudgetTool,
  setCarryoverTool,
  holdTool,
  resetHoldTool,
  strategyTool,
];

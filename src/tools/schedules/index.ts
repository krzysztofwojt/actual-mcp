import { APIScheduleEntity } from '@actual-app/api/models';
import { z } from 'zod';
import { getAccounts, getPayees } from '../../actual-api.js';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import { formatMoney, parseMoney } from '../../core/input/money.js';
import { createSchedule, deleteSchedule, getSchedules, updateSchedule } from '../../domain/schedule-api.js';
import { defineTool, ToolModule } from '../tool-factory.js';

const ReferenceSchema = z.string().min(1).describe('Exact ID or unique case-insensitive name');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const RecurSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().positive().optional(),
  patterns: z
    .array(z.object({ value: z.number().int(), type: z.enum(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'day']) }))
    .optional(),
  skipWeekend: z.boolean().optional(),
  start: DateSchema,
  endMode: z.enum(['never', 'after_n_occurrences', 'on_date']).optional(),
  endOccurrences: z.number().int().positive().optional(),
  endDate: DateSchema.optional(),
  weekendSolveMode: z.enum(['before', 'after']).optional(),
});
const ScheduleDateSchema = z.union([DateSchema, RecurSchema]);
const AmountFieldsSchema = z.object({
  amount: z.string().describe('Exact decimal amount, for example -12.34'),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).default('is'),
  amountEnd: z.string().optional().describe('Second exact decimal amount; required for isbetween'),
});

async function schedule(reference: string): Promise<APIScheduleEntity> {
  return resolveEntity(reference, await getSchedules(), (item) => item.name ?? '', 'schedule');
}

async function account(reference: string): Promise<Awaited<ReturnType<typeof getAccounts>>[number]> {
  return resolveEntity(reference, await getAccounts(), (item) => item.name, 'account');
}

async function payee(reference: string): Promise<Awaited<ReturnType<typeof getPayees>>[number]> {
  return resolveEntity(reference, await getPayees(), (item) => item.name, 'payee');
}

function amountValue(
  amount: string,
  amountOp: 'is' | 'isapprox' | 'isbetween',
  amountEnd?: string
): number | { num1: number; num2: number } {
  if (amountOp === 'isbetween') {
    if (!amountEnd) throw new Error('SCHEDULE_AMOUNT_END_REQUIRED');
    return { num1: parseMoney(amount), num2: parseMoney(amountEnd) };
  }
  if (amountEnd !== undefined) throw new Error('SCHEDULE_AMOUNT_END_ONLY_FOR_BETWEEN');
  return parseMoney(amount);
}

function present(item: APIScheduleEntity): Record<string, unknown> {
  const amount =
    typeof item.amount === 'number'
      ? formatMoney(item.amount)
      : item.amount
        ? { from: formatMoney(item.amount.num1), to: formatMoney(item.amount.num2) }
        : undefined;
  return { ...item, amount };
}

const getSchedulesTool = defineTool(
  'get-schedules',
  'List recurring and one-time schedules with decimal-formatted amounts.',
  z.object({}),
  async () => ({ schedules: (await getSchedules()).map(present) })
);

const createScheduleTool = defineTool(
  'create-schedule',
  'Create a transaction schedule and verify it by reading it back.',
  z
    .object({
      name: z.string().trim().min(1),
      account: ReferenceSchema,
      payee: ReferenceSchema,
      date: ScheduleDateSchema,
      postsTransaction: z.boolean().default(false),
    })
    .extend(AmountFieldsSchema.shape),
  async ({
    name,
    account: accountReference,
    payee: payeeReference,
    date,
    postsTransaction,
    amount,
    amountOp,
    amountEnd,
  }) => {
    const selectedAccount = await account(accountReference);
    const selectedPayee = await payee(payeeReference);
    const id = await createSchedule({
      name,
      account: selectedAccount.id,
      payee: selectedPayee.id,
      date,
      amount: amountValue(amount, amountOp, amountEnd),
      amountOp,
      posts_transaction: postsTransaction,
    });
    const created = (await getSchedules()).find((item) => item.id === id);
    if (!created) throw new Error(`SCHEDULE_READBACK_MISSING: ${id}`);
    return { schedule: present(created) };
  }
);

const updateScheduleTool = defineTool(
  'update-schedule',
  'Update a transaction schedule and verify it by reading it back.',
  z.object({
    schedule: ReferenceSchema,
    name: z.string().trim().min(1).optional(),
    account: ReferenceSchema.optional(),
    payee: ReferenceSchema.optional(),
    date: ScheduleDateSchema.optional(),
    postsTransaction: z.boolean().optional(),
    amount: z.string().optional(),
    amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional(),
    amountEnd: z.string().optional(),
    resetNextDate: z
      .boolean()
      .optional()
      .describe('Override next-date recalculation. If omitted, recalculate only when date changes.'),
  }),
  async ({
    schedule: reference,
    account: accountReference,
    payee: payeeReference,
    amount,
    amountOp,
    amountEnd,
    postsTransaction,
    resetNextDate,
    ...rest
  }) => {
    const current = await schedule(reference);
    const selectedAccount = accountReference ? await account(accountReference) : undefined;
    const selectedPayee = payeeReference ? await payee(payeeReference) : undefined;
    const effectiveOp = amountOp ?? current.amountOp;
    const fields: Partial<APIScheduleEntity> = {
      ...rest,
      ...(selectedAccount ? { account: selectedAccount.id } : {}),
      ...(selectedPayee ? { payee: selectedPayee.id } : {}),
      ...(postsTransaction === undefined ? {} : { posts_transaction: postsTransaction }),
      ...(amount === undefined ? {} : { amount: amountValue(amount, effectiveOp, amountEnd) }),
      ...(amountOp === undefined ? {} : { amountOp }),
    };
    if (!Object.keys(fields).length) throw new Error('NO_SCHEDULE_CHANGES');
    const shouldResetNextDate = resetNextDate ?? rest.date !== undefined;
    await updateSchedule(current.id, fields, shouldResetNextDate);
    const updated = (await getSchedules()).find((item) => item.id === current.id);
    if (!updated) throw new Error(`SCHEDULE_READBACK_MISSING: ${current.id}`);
    return { schedule: present(updated) };
  }
);

const deleteScheduleTool = defineTool(
  'delete-schedule',
  'Delete a schedule and verify it no longer exists.',
  z.object({ schedule: ReferenceSchema }),
  async ({ schedule: reference }) => {
    const current = await schedule(reference);
    await deleteSchedule(current.id);
    if ((await getSchedules()).some((item) => item.id === current.id))
      throw new Error(`SCHEDULE_DELETE_READBACK_MISMATCH: ${current.id}`);
    return { deletedScheduleId: current.id, deletedScheduleName: current.name };
  }
);

export const scheduleReadTools: ToolModule[] = [getSchedulesTool];
export const scheduleWriteTools: ToolModule[] = [createScheduleTool, updateScheduleTool, deleteScheduleTool];

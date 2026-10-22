import { z } from 'zod';

const RuleConditionValueSchema = z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]);
const RuleActionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const FormulaSchema = z.string().refine((formula) => formula.startsWith('=') && formula.slice(1).trim().length > 0, {
  message: 'formula must start with = and contain an expression',
});

const RuleConditionSchema = z.object({
  field: z.enum(['account', 'category', 'date', 'payee', 'amount', 'imported_payee', 'notes']),
  op: z.enum([
    'is',
    'isNot',
    'oneOf',
    'notOneOf',
    'onBudget',
    'offBudget',
    'isapprox',
    'gt',
    'gte',
    'lt',
    'lte',
    'isbetween',
    'contains',
    'doesNotContain',
    'matches',
    'hasTags',
  ]),
  value: RuleConditionValueSchema,
});

const RuleActionOptionsSchema = z.object({
  splitIndex: z.number().int().nonnegative().optional(),
  method: z
    .enum(['fixed-amount', 'fixed-percent', 'formula', 'remainder'])
    .optional()
    .describe('Native Actual split amount method. formula requires options.formula and value null (or 0).'),
  formula: z
    .string()
    .optional()
    .describe(
      'Native Actual formula beginning with =. Numeric results use major currency units, not cents. Split formulas can use parent_amount (cents); parent text fields require an Actual engine supporting them.'
    ),
  template: z.string().optional(),
});

const RuleActionSchema = z
  .object({
    field: z.enum(['account', 'category', 'date', 'payee', 'amount', 'cleared', 'notes']).nullable(),
    op: z.enum(['set', 'prepend-notes', 'append-notes', 'set-split-amount']),
    value: RuleActionValueSchema,
    type: z.string().optional(),
    options: RuleActionOptionsSchema.optional(),
  })
  .superRefine((action, ctx) => {
    const options = action.options;

    if (action.op === 'set') {
      if (options?.formula !== undefined) {
        const result = FormulaSchema.safeParse(options.formula);
        if (!result.success) {
          ctx.addIssue({ path: ['options', 'formula'], code: 'custom', message: result.error.issues[0]?.message });
        }
      }
      if (options?.method !== undefined) {
        ctx.addIssue({
          path: ['options', 'method'],
          code: 'custom',
          message: 'method is only valid for set-split-amount actions',
        });
      }
      return;
    }

    if (action.op !== 'set-split-amount') {
      if (options?.method !== undefined || options?.formula !== undefined || options?.template !== undefined) {
        ctx.addIssue({
          path: ['options'],
          code: 'custom',
          message: 'method, formula, and template are only valid for set or set-split-amount actions',
        });
      }
      return;
    }

    if (action.field !== null && action.field !== 'amount') {
      ctx.addIssue({ path: ['field'], code: 'custom', message: 'split amount field must be null or amount' });
    }
    if (options?.template !== undefined) {
      ctx.addIssue({
        path: ['options', 'template'],
        code: 'custom',
        message: 'template is only valid for set actions',
      });
    }
    if (!options) {
      ctx.addIssue({ path: ['options'], code: 'custom', message: 'split amount options are required' });
      return;
    }
    if (options.splitIndex === undefined || options.splitIndex <= 0) {
      ctx.addIssue({
        path: ['options', 'splitIndex'],
        code: 'custom',
        message: 'split amount splitIndex must be a positive integer',
      });
    }
    if (options.method === undefined) {
      ctx.addIssue({ path: ['options', 'method'], code: 'custom', message: 'split amount method is required' });
      return;
    }

    if (options.method === 'formula') {
      if (action.value !== null && action.value !== 0) {
        ctx.addIssue({ path: ['value'], code: 'custom', message: 'formula split amount value must be null or 0' });
      }
      if (options.formula === undefined) {
        ctx.addIssue({
          path: ['options', 'formula'],
          code: 'custom',
          message: 'formula is required for formula split amounts',
        });
      } else {
        const result = FormulaSchema.safeParse(options.formula);
        if (!result.success) {
          ctx.addIssue({ path: ['options', 'formula'], code: 'custom', message: result.error.issues[0]?.message });
        }
      }
      return;
    }

    if (options.formula !== undefined) {
      ctx.addIssue({
        path: ['options', 'formula'],
        code: 'custom',
        message: 'formula is only valid with method formula',
      });
    }
    if (options.method === 'remainder') {
      if (action.value !== null && action.value !== 0) {
        ctx.addIssue({ path: ['value'], code: 'custom', message: 'remainder split amount value must be null or 0' });
      }
      return;
    }

    if (typeof action.value !== 'number' || !Number.isFinite(action.value)) {
      ctx.addIssue({ path: ['value'], code: 'custom', message: 'fixed split amount value must be a finite number' });
    }
    if (
      options.method === 'fixed-percent' &&
      typeof action.value === 'number' &&
      Number.isFinite(action.value) &&
      (action.value < 0 || action.value > 100)
    ) {
      ctx.addIssue({
        path: ['value'],
        code: 'custom',
        message: 'fixed-percent split amount value must be between 0 and 100',
      });
    }
  });

const RuleFieldsSchema = z.object({
  stage: z.enum(['pre', 'post']).nullable(),
  conditionsOp: z.enum(['and', 'or']),
  conditions: z.array(RuleConditionSchema),
  actions: z.array(RuleActionSchema),
});

export const CreateRuleArgsSchema = RuleFieldsSchema.strict();

export const UpdateRuleArgsSchema = RuleFieldsSchema.partial()
  .extend({ id: z.string().trim().min(1) })
  .strict()
  .refine(({ id: _id, ...changes }) => Object.keys(changes).length > 0, {
    message: 'At least one rule field must be provided for update',
  });

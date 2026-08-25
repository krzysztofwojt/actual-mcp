import { z } from 'zod';

const RuleConditionValueSchema = z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]);
const RuleActionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const RuleConditionSchema = z.object({
  field: z.enum(['account', 'category', 'date', 'payee', 'amount', 'imported_payee']),
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

const RuleActionSchema = z.object({
  field: z.enum(['account', 'category', 'date', 'payee', 'amount', 'cleared', 'notes']).nullable(),
  op: z.enum(['set', 'prepend-notes', 'append-notes', 'set-split-amount']),
  value: RuleActionValueSchema,
  options: z
    .object({
      splitIndex: z.number().int().nonnegative().optional(),
      method: z.enum(['fixed-amount', 'fixed-percent', 'remainder']).optional(),
    })
    .optional(),
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

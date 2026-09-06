import { describe, expect, it, vi } from 'vitest';
import { schema as createRuleSchema } from './create-rule/index.js';
import { schema as updateRuleSchema } from './update-rule/index.js';
import { handler as getRules } from './get-rules/index.js';
import { CreateRuleArgsSchema, UpdateRuleArgsSchema } from './input-schema.js';

vi.mock('../../core/data/fetch-rules.js', () => ({
  fetchAllRules: vi.fn(),
}));

import * as rulesData from '../../core/data/fetch-rules.js';

const baseRule = {
  stage: 'pre' as const,
  conditionsOp: 'and' as const,
  conditions: [{ field: 'notes' as const, op: 'contains' as const, value: 'KAPITAŁ:' }],
};

const splitAction = {
  field: null,
  op: 'set-split-amount' as const,
  value: null,
  options: {
    splitIndex: 1,
    method: 'formula' as const,
    formula: '=parent_amount',
  },
};

describe('formula split rule contract', () => {
  it('accepts native formula, fixed, percent, and remainder split actions', () => {
    const actions = [
      splitAction,
      {
        field: 'amount' as const,
        op: 'set-split-amount' as const,
        value: -66194,
        options: { splitIndex: 1, method: 'fixed-amount' as const },
      },
      {
        field: null,
        op: 'set-split-amount' as const,
        value: 25,
        options: { splitIndex: 2, method: 'fixed-percent' as const },
      },
      {
        field: null,
        op: 'set-split-amount' as const,
        value: 0,
        options: { splitIndex: 3, method: 'remainder' as const },
      },
    ];

    for (const action of actions) {
      expect(CreateRuleArgsSchema.parse({ ...baseRule, actions: [action] }).actions).toEqual([action]);
    }
  });

  it('accepts formula options on an ordinary set action', () => {
    const action = {
      field: 'amount' as const,
      op: 'set' as const,
      value: 0,
      options: { formula: '=parent_amount' },
    };

    expect(CreateRuleArgsSchema.parse({ ...baseRule, actions: [action] }).actions).toEqual([action]);
  });

  it('preserves native action metadata when updating a returned rule', () => {
    const action = { ...splitAction, type: 'number' };

    expect(UpdateRuleArgsSchema.parse({ id: 'rule-1', actions: [action] })).toEqual({
      id: 'rule-1',
      actions: [action],
    });
  });

  it.each([
    ['missing method', { field: null, op: 'set-split-amount', value: null, options: { splitIndex: 1, formula: '=1' } }],
    ['zero split index', { ...splitAction, options: { ...splitAction.options, splitIndex: 0 } }],
    ['formula without expression', { ...splitAction, options: { ...splitAction.options, formula: '=' } }],
    ['formula with nonzero value', { ...splitAction, value: 1 }],
    [
      'formula on remainder',
      { field: null, op: 'set-split-amount', value: 0, options: { splitIndex: 1, method: 'remainder', formula: '=1' } },
    ],
    [
      'nonfinite fixed amount',
      {
        field: null,
        op: 'set-split-amount',
        value: Number.POSITIVE_INFINITY,
        options: { splitIndex: 1, method: 'fixed-amount' },
      },
    ],
    [
      'percent out of range',
      { field: null, op: 'set-split-amount', value: 101, options: { splitIndex: 1, method: 'fixed-percent' } },
    ],
    ['method on ordinary action', { field: 'amount', op: 'set', value: 0, options: { method: 'remainder' } }],
  ])('rejects %s', (_name, action) => {
    expect(() => CreateRuleArgsSchema.parse({ ...baseRule, actions: [action] })).toThrow();
  });

  it('validates formula split actions in partial updates', () => {
    expect(UpdateRuleArgsSchema.parse({ id: 'rule-1', actions: [splitAction] })).toEqual({
      id: 'rule-1',
      actions: [splitAction],
    });
    expect(() =>
      UpdateRuleArgsSchema.parse({
        id: 'rule-1',
        actions: [{ ...splitAction, options: { ...splitAction.options, formula: '' } }],
      })
    ).toThrow();
  });

  it('exposes formula and notes in the generated MCP schemas', () => {
    const json = JSON.stringify([createRuleSchema.inputSchema, updateRuleSchema.inputSchema]);

    expect(json).toContain('formula');
    expect(json).toContain('notes');
  });

  it('returns formula split actions unchanged from get-rules', async () => {
    const rule = { id: 'rule-1', ...baseRule, actions: [splitAction] };
    vi.mocked(rulesData.fetchAllRules).mockResolvedValue([rule] as never);

    const result = await getRules();

    expect(result.isError).toBeUndefined();
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('"method":"formula"');
      expect(content.text).toContain('"formula":"=parent_amount"');
    }
  });
});

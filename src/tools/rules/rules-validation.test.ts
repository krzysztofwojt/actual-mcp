import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler as createRule } from './create-rule/index.js';
import { handler as updateRule } from './update-rule/index.js';

vi.mock('../../actual-api.js', () => ({
  createRule: vi.fn(),
  updateRule: vi.fn(),
  getRules: vi.fn(),
}));

import * as actualApi from '../../actual-api.js';

const validRule = {
  stage: 'pre' as const,
  conditionsOp: 'and' as const,
  conditions: [{ field: 'payee', op: 'is', value: 'payee-1' }],
  actions: [{ field: 'category', op: 'set', value: 'category-1' }],
};

const formulaSplitAction = {
  field: null,
  op: 'set-split-amount' as const,
  value: null,
  options: {
    splitIndex: 1,
    method: 'formula' as const,
    formula: '=parent_amount',
  },
};

describe('rule handler validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an incomplete create request before calling Actual', async () => {
    const result = await createRule({ conditionsOp: 'and' });
    expect(result.isError).toBe(true);
    expect(actualApi.createRule).not.toHaveBeenCalled();
  });

  it('validates and creates a complete rule', async () => {
    vi.mocked(actualApi.createRule).mockResolvedValue({ id: 'rule-1' } as never);
    vi.mocked(actualApi.getRules).mockResolvedValue([{ id: 'rule-1', ...validRule }] as never);

    const result = await createRule(validRule);

    expect(result.isError).toBeUndefined();
    expect(actualApi.createRule).toHaveBeenCalledWith(validRule);
  });

  it('rejects an update containing only an id', async () => {
    const result = await updateRule({ id: 'rule-1' });
    expect(result.isError).toBe(true);
    expect(actualApi.updateRule).not.toHaveBeenCalled();
  });

  it('accepts a validated partial update', async () => {
    vi.mocked(actualApi.updateRule).mockResolvedValue({ id: 'rule-1' } as never);
    vi.mocked(actualApi.getRules).mockResolvedValue([{ id: 'rule-1', ...validRule, conditionsOp: 'or' }] as never);

    const result = await updateRule({ id: 'rule-1', conditionsOp: 'or' });

    expect(result.isError).toBeUndefined();
    expect(actualApi.updateRule).toHaveBeenCalledWith({ id: 'rule-1', conditionsOp: 'or' });
  });

  it('creates a formula split action and returns the native action on readback', async () => {
    const rule = { ...validRule, actions: [formulaSplitAction] };
    vi.mocked(actualApi.createRule).mockResolvedValue({ id: 'rule-formula' } as never);
    vi.mocked(actualApi.getRules).mockResolvedValue([{ id: 'rule-formula', ...rule }] as never);

    const result = await createRule(rule);

    expect(result.isError).toBeUndefined();
    expect(actualApi.createRule).toHaveBeenCalledWith(rule);
    expect(actualApi.getRules).toHaveBeenCalled();
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('"method":"formula"');
      expect(content.text).toContain('"formula":"=parent_amount"');
    }
  });

  it('updates a formula split action and returns the native action on readback', async () => {
    const changes = { id: 'rule-formula', actions: [formulaSplitAction] };
    vi.mocked(actualApi.updateRule).mockResolvedValue({ id: 'rule-formula' } as never);
    vi.mocked(actualApi.getRules).mockResolvedValue([
      { id: 'rule-formula', ...validRule, actions: changes.actions },
    ] as never);

    const result = await updateRule(changes);

    expect(result.isError).toBeUndefined();
    expect(actualApi.updateRule).toHaveBeenCalledWith(changes);
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('"method":"formula"');
      expect(content.text).toContain('"formula":"=parent_amount"');
    }
  });

  it.each([
    ['fixed-amount', -66194],
    ['fixed-percent', 25],
    ['remainder', 0],
  ])('round-trips the %s split method', async (method, value) => {
    const rule = {
      ...validRule,
      actions: [
        {
          field: null,
          op: 'set-split-amount',
          value,
          options: { splitIndex: 1, method },
        },
      ],
    };
    vi.mocked(actualApi.createRule).mockResolvedValue({ id: 'rule-fixed' } as never);
    vi.mocked(actualApi.getRules).mockResolvedValue([{ id: 'rule-fixed', ...rule }] as never);

    const result = await createRule(rule);

    expect(result.isError).toBeUndefined();
    expect(actualApi.createRule).toHaveBeenCalledWith(rule);
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain(`"method":"${method}"`);
    }
  });

  it('rejects invalid formula split actions before calling Actual', async () => {
    const invalidCreate = {
      ...validRule,
      actions: [
        {
          ...formulaSplitAction,
          options: { ...formulaSplitAction.options, formula: 'parent_amount' },
        },
      ],
    };
    const invalidUpdate = {
      id: 'rule-formula',
      actions: [
        {
          ...formulaSplitAction,
          options: { ...formulaSplitAction.options, method: 'remainder' as const },
        },
      ],
    };

    const createResult = await createRule(invalidCreate);
    const updateResult = await updateRule(invalidUpdate);

    expect(createResult.isError).toBe(true);
    expect(updateResult.isError).toBe(true);
    expect(actualApi.createRule).not.toHaveBeenCalled();
    expect(actualApi.updateRule).not.toHaveBeenCalled();
  });
});

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
});

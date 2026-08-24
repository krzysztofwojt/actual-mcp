import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metadataReadTools, metadataWriteTools } from './index.js';

vi.mock('../../actual-api.js', () => ({
  getAccounts: vi.fn(),
  getPayees: vi.fn(),
  getTransactions: vi.fn(),
  updateTransaction: vi.fn(),
}));
vi.mock('../../domain/metadata-api.js', () => ({
  getTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  getNote: vi.fn(),
  updateNote: vi.fn(),
  mergePayees: vi.fn(),
}));

import { getAccounts, getTransactions, updateTransaction } from '../../actual-api.js';
import * as metadataApi from '../../domain/metadata-api.js';

function handler(name: string): (typeof metadataWriteTools)[number]['handler'] {
  return [...metadataReadTools, ...metadataWriteTools].find((tool) => tool.schema.name === name)!.handler;
}

describe('metadata tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers tag, note, merge, and transaction assignment tools', () => {
    expect([...metadataReadTools, ...metadataWriteTools].map((tool) => tool.schema.name)).toContain(
      'assign-transaction-tag'
    );
    expect(metadataWriteTools.map((tool) => tool.schema.name)).toContain('merge-payees');
  });

  it('creates and reads back a tag', async () => {
    vi.mocked(metadataApi.getTags)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'tag1', tag: 'tax' }]);
    vi.mocked(metadataApi.createTag).mockResolvedValue('tag1');
    const result = await handler('create-tag')({ tag: 'tax' } as never);
    expect(result.isError).toBeUndefined();
  });

  it('assigns a configured tag token to transaction notes and verifies it', async () => {
    vi.mocked(metadataApi.getTags).mockResolvedValue([{ id: 'tag1', tag: 'tax' }]);
    vi.mocked(getAccounts).mockResolvedValue([{ id: 'a1', name: 'Checking' }]);
    vi.mocked(getTransactions)
      .mockResolvedValueOnce([{ id: 't1', notes: 'invoice' } as never])
      .mockResolvedValueOnce([{ id: 't1', notes: 'invoice #tax' } as never]);
    const result = await handler('assign-transaction-tag')({
      transactionId: 't1',
      account: 'Checking',
      date: '2026-08-24',
      tag: 'tax',
    } as never);
    expect(updateTransaction).toHaveBeenCalledWith('t1', { notes: 'invoice #tax' });
    expect(result.isError).toBeUndefined();
  });

  it('rejects ambiguous tag names', async () => {
    vi.mocked(metadataApi.getTags).mockResolvedValue([
      { id: '1', tag: 'Tax' },
      { id: '2', tag: 'tax' },
    ]);
    const result = await handler('delete-tag')({ tag: 'tax' } as never);
    expect(result.isError).toBe(true);
  });
});

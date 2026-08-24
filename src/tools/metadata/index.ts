import { z } from 'zod';
import { getAccounts, getPayees, getTransactions, updateTransaction } from '../../actual-api.js';
import { resolveEntity } from '../../core/input/entity-resolver.js';
import {
  createTag,
  deleteTag,
  getNote,
  getTags,
  mergePayees,
  updateNote,
  updateTag,
} from '../../domain/metadata-api.js';
import { defineTool, ToolModule } from '../tool-factory.js';

const ReferenceSchema = z.string().min(1).describe('Exact ID or unique case-insensitive name');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

async function tag(reference: string): Promise<Awaited<ReturnType<typeof getTags>>[number]> {
  return resolveEntity(reference, await getTags(), (item) => item.tag, 'tag');
}

async function payee(reference: string): Promise<Awaited<ReturnType<typeof getPayees>>[number]> {
  return resolveEntity(reference, await getPayees(), (item) => item.name, 'payee');
}

async function transaction(
  accountReference: string,
  date: string,
  transactionId: string
): Promise<Awaited<ReturnType<typeof getTransactions>>[number]> {
  const selectedAccount = resolveEntity(accountReference, await getAccounts(), (item) => item.name, 'account');
  const selected = (await getTransactions(selectedAccount.id, date, date)).find((item) => item.id === transactionId);
  if (!selected) throw new Error(`UNKNOWN_TRANSACTION: ${transactionId} in account ${selectedAccount.id} on ${date}`);
  return selected;
}

const getTagsTool = defineTool('get-tags', 'List all configured transaction tags.', z.object({}), async () => ({
  tags: await getTags(),
}));

const createTagTool = defineTool(
  'create-tag',
  'Create a transaction tag and verify it by reading it back.',
  z.object({
    tag: z.string().trim().min(1),
    color: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
  async (fields) => {
    const duplicates = (await getTags()).filter(
      (item) => item.tag.toLocaleLowerCase() === fields.tag.toLocaleLowerCase()
    );
    if (duplicates.length) throw new Error(`TAG_EXISTS: ${fields.tag}`);
    const id = await createTag(fields);
    const created = (await getTags()).find((item) => item.id === id);
    if (!created) throw new Error(`TAG_READBACK_MISSING: ${id}`);
    return { tag: created };
  }
);

const updateTagTool = defineTool(
  'update-tag',
  'Update a tag and verify it by reading it back.',
  z.object({
    idOrName: ReferenceSchema,
    tag: z.string().trim().min(1).optional(),
    color: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
  async ({ idOrName, ...fields }) => {
    if (!Object.values(fields).some((value) => value !== undefined)) throw new Error('NO_TAG_CHANGES');
    const current = await tag(idOrName);
    await updateTag(current.id, fields);
    const updated = (await getTags()).find((item) => item.id === current.id);
    if (!updated) throw new Error(`TAG_READBACK_MISSING: ${current.id}`);
    return { tag: updated };
  }
);

const deleteTagTool = defineTool(
  'delete-tag',
  'Delete a tag and verify it no longer exists.',
  z.object({ tag: ReferenceSchema }),
  async ({ tag: reference }) => {
    const current = await tag(reference);
    await deleteTag(current.id);
    if ((await getTags()).some((item) => item.id === current.id))
      throw new Error(`TAG_DELETE_READBACK_MISMATCH: ${current.id}`);
    return { deletedTagId: current.id, deletedTag: current.tag };
  }
);

const getNoteTool = defineTool(
  'get-note',
  'Read the generic Actual note attached to an entity ID such as a category or budget month.',
  z.object({ entityId: z.string().min(1) }),
  async ({ entityId }) => ({ entityId, note: await getNote(entityId) })
);

const updateNoteTool = defineTool(
  'update-note',
  'Set or clear the generic Actual note attached to an entity ID and verify it.',
  z.object({ entityId: z.string().min(1), note: z.string() }),
  async ({ entityId, note }) => {
    await updateNote(entityId, note);
    const readback = await getNote(entityId);
    const value = readback?.note ?? '';
    if (value !== note) throw new Error(`NOTE_READBACK_MISMATCH: ${entityId}`);
    return { entityId, note: value };
  }
);

const mergePayeesTool = defineTool(
  'merge-payees',
  'Merge one or more payees into a target payee and verify the merged payees were removed.',
  z.object({ target: ReferenceSchema, merge: z.array(ReferenceSchema).min(1) }),
  async ({ target, merge }) => {
    const targetPayee = await payee(target);
    const sources = await Promise.all(merge.map((reference) => payee(reference)));
    const sourceIds = [...new Set(sources.map((item) => item.id))];
    if (sourceIds.includes(targetPayee.id)) throw new Error('PAYEE_MERGE_TARGET_INCLUDED_IN_SOURCES');
    await mergePayees(targetPayee.id, sourceIds);
    const remaining = await getPayees();
    const notRemoved = sourceIds.filter((id) => remaining.some((item) => item.id === id));
    if (notRemoved.length) throw new Error(`PAYEE_MERGE_READBACK_MISMATCH: ${notRemoved.join(', ')}`);
    return { targetPayeeId: targetPayee.id, mergedPayeeIds: sourceIds };
  }
);

const assignTransactionTagTool = defineTool(
  'assign-transaction-tag',
  'Assign a configured tag to a transaction by updating its Actual notes tag token.',
  z.object({ transactionId: z.string().min(1), account: ReferenceSchema, date: DateSchema, tag: ReferenceSchema }),
  async ({ transactionId, account, date, tag: reference }) => {
    const configuredTag = await tag(reference);
    const current = await transaction(account, date, transactionId);
    const token = `#${configuredTag.tag}`;
    const notes = current.notes?.trim() ?? '';
    const updatedNotes = notes.split(/\s+/).includes(token) ? notes : [notes, token].filter(Boolean).join(' ');
    await updateTransaction(transactionId, { notes: updatedNotes });
    const readback = await transaction(account, date, transactionId);
    if (!(readback.notes ?? '').split(/\s+/).includes(token))
      throw new Error(`TRANSACTION_TAG_READBACK_MISMATCH: ${transactionId}`);
    return { transactionId, tagId: configuredTag.id, tag: configuredTag.tag, notes: readback.notes };
  }
);

export const metadataReadTools: ToolModule[] = [getTagsTool, getNoteTool];
export const metadataWriteTools: ToolModule[] = [
  createTagTool,
  updateTagTool,
  deleteTagTool,
  updateNoteTool,
  mergePayeesTool,
  assignTransactionTagTool,
];

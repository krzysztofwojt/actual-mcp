import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('@actual-app/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actual-app/api')>();
  return { ...actual, downloadBudget: actual.loadBudget };
});
import * as api from '@actual-app/api';
import { formatMoney } from './core/input/money.js';
import { fetchTransactionsForAccount } from './core/data/fetch-transactions.js';
import { GetTransactionsMapper } from './tools/get-transactions/transaction-mapper.js';
import { GetTransactionsReportGenerator } from './tools/get-transactions/report-generator.js';
import { getTransactionById, shutdownActualApi, updateTransaction } from './actual-api.js';

let directory: string;
let source: string;
let destination: string;
let category: string;
let bank: string;
let transfer: string;
const nativeTransferId = 'a1c28b55-dc61-46c8-9931-10a77c2f3bdb';
const normalId = 'controlled-normal-transaction';
const parentId = 'a855487d-e24d-4b4b-965c-792c4b6c4a1a';
const originalEnvironment = { ...process.env };

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'actual-split-transfer-'));
  delete process.env.ACTUAL_SERVER_URL;
  delete process.env.ACTUAL_PASSWORD;
  delete process.env.ACTUAL_BUDGET_SYNC_ID;
  process.env.ACTUAL_DATA_DIR = directory;
  process.env.ACTUAL_SYNC_TTL_MS = '-1';
  await api.init({ dataDir: directory });
  await api.runImport('Split transfer regression', async () => {
    source = await api.createAccount({ name: 'Wspólne - Pekao', offbudget: false });
    destination = await api.createAccount({ name: 'Kredyt Hipoteczny', offbudget: true });
    const group = await api.createCategoryGroup({ name: 'Housing' });
    category = await api.createCategory({ name: '🏡 Kredyt Hipoteczny', group_id: group });
    bank = await api.createPayee({ name: 'Bank Pekao S.A.' });
    transfer = (await api.getPayees()).find((payee) => payee.transfer_acct === destination)!.id;
    const importedParent = {
      id: parentId,
      date: '2024-10-28',
      amount: -280009,
      imported_id: 'bank-import-preserved',
      payee: bank,
      subtransactions: [
        { amount: -89161, category, notes: 'Old capital' },
        { amount: -190848, category, notes: 'Old interest' },
      ],
    };
    await api.addTransactions(source, [importedParent]);
    const nativeTransfer = {
      id: nativeTransferId,
      date: '2025-04-08',
      amount: -76489,
      imported_id: 'interest-bank-import',
      payee: transfer,
      category,
      notes: 'SPŁATA ODSETEK',
    };
    const normal = {
      id: normalId,
      date: '2025-04-09',
      amount: -12345,
      imported_id: 'normal-bank-import',
      payee: bank,
      category,
      notes: 'Kapitał',
    };
    await api.addTransactions(source, [nativeTransfer, normal], { runTransfers: true });
  });
  await api.shutdown();
}, 30000);

afterAll(async () => {
  await shutdownActualApi();
  process.env = originalEnvironment;
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('updates an imported parent with a native transfer child and reads the complete split back', async () => {
  await expect(
    updateTransaction(parentId, {
      subtransactions: [
        { amount: '-891.61', category, payee: transfer, notes: 'Kapitał' },
        { amount: '-1908.48', category, payee: bank, notes: 'Odsetki' },
      ],
    })
  ).resolves.toHaveLength(1);
  const parent = await getTransactionById(parentId);
  expect(parent).toMatchObject({ id: parentId, imported_id: 'bank-import-preserved', amount: -280009 });
  expect(parent!.subtransactions).toHaveLength(2);
  const children = parent!.subtransactions!;
  expect(children.reduce((sum, child) => sum + child.amount, 0)).toBe(parent!.amount);
  expect(children.find((child) => child.payee === transfer)).toMatchObject({
    amount: -89161,
    category,
    notes: 'Kapitał',
  });
  expect(children.find((child) => child.payee === bank)).toMatchObject({ amount: -190848, category, notes: 'Odsetki' });
  const counterparts = await api.getTransactions(destination, '2024-10-28', '2024-10-28');
  expect(counterparts).toHaveLength(1);
  expect(counterparts[0]).toMatchObject({
    amount: 89161,
    notes: 'Kapitał',
    transfer_id: children.find((child) => child.payee === transfer)!.id,
  });
  const listed = await fetchTransactionsForAccount(source, '2024-10-28', '2024-10-28');
  const mapped = new GetTransactionsMapper().map(listed);
  expect(mapped[0].subtransactions).toHaveLength(2);
  const report = new GetTransactionsReportGenerator().generate(mapped, '', 1, 1);
  expect(report).toContain(`Split parent ${parentId}`);
  expect(report).toContain('🏡 Kredyt Hipoteczny');
  expect(report).toContain('Kapitał');
  expect(report).toContain('Odsetki');
  expect(report).toContain(counterparts[0].id);
  expect(await getTransactionById(parentId)).toEqual(parent);
  await expect(
    updateTransaction(parentId, {
      subtransactions: children.map((child) => ({
        id: child.id,
        amount: formatMoney(child.amount),
        category: child.category,
        payee: child.payee ?? undefined,
        notes: child.notes,
      })),
    })
  ).resolves.toHaveLength(1);
  expect(await api.getTransactions(destination, '2024-10-28', '2024-10-28')).toHaveLength(1);
  await expect(updateTransaction(parentId, { notes: 'Parent note' })).resolves.toHaveLength(1);
}, 30000);

it('converts a native transfer to a normal expense and removes the old counterpart', async () => {
  const before = await getTransactionById(nativeTransferId);
  expect(before).toMatchObject({ id: nativeTransferId, payee: transfer });
  expect(before!.transfer_id).toBeTruthy();
  const counterpartId = before!.transfer_id!;
  expect(await getTransactionById(counterpartId)).toMatchObject({ amount: 76489, transfer_id: nativeTransferId });
  await expect(
    updateTransaction(nativeTransferId, { payee: bank, category, notes: 'SPŁATA ODSETEK' })
  ).resolves.toHaveLength(1);
  const observed = await getTransactionById(nativeTransferId);
  expect(observed).toMatchObject({
    id: nativeTransferId,
    account: source,
    imported_id: 'interest-bank-import',
    amount: -76489,
    payee: bank,
    category,
    notes: 'SPŁATA ODSETEK',
    transfer_id: null,
    is_parent: false,
  });
  expect(await getTransactionById(counterpartId)).toBeUndefined();
  expect(await api.getTransactions(destination, '2025-04-08', '2025-04-08')).toHaveLength(0);
  expect(await getTransactionById(nativeTransferId)).toEqual(observed);
});

it('converts a normal expense to a native transfer and verifies reciprocal links', async () => {
  expect(await getTransactionById(normalId)).toMatchObject({ payee: bank, transfer_id: null });
  await expect(updateTransaction(normalId, { payee: transfer, category, notes: 'Kapitał' })).resolves.toHaveLength(1);
  const observed = await getTransactionById(normalId);
  expect(observed).toMatchObject({
    id: normalId,
    account: source,
    imported_id: 'normal-bank-import',
    amount: -12345,
    payee: transfer,
    category,
    notes: 'Kapitał',
    is_parent: false,
  });
  expect(observed!.transfer_id).toBeTruthy();
  const counterparts = await api.getTransactions(destination, '2025-04-09', '2025-04-09');
  expect(counterparts).toHaveLength(1);
  expect(counterparts[0]).toMatchObject({
    id: observed!.transfer_id,
    amount: 12345,
    transfer_id: normalId,
    notes: 'Kapitał',
  });
  expect(counterparts[0].id).not.toBe(normalId);
  expect(await getTransactionById(normalId)).toEqual(observed);
});

it('accepts standalone transfer category normalization between on-budget accounts', async () => {
  const target = await api.createAccount({ name: 'Standalone budget destination', offbudget: false });
  const payee = (await api.getPayees()).find((item) => item.transfer_acct === target)!.id;
  await expect(updateTransaction(normalId, { payee: bank, category })).resolves.toHaveLength(1);
  await expect(updateTransaction(normalId, { payee, category })).resolves.toHaveLength(1);
  const observed = await getTransactionById(normalId);
  expect(observed).toMatchObject({ id: normalId, payee, category: null, amount: -12345 });
  const counterparts = await api.getTransactions(target, '2025-04-09', '2025-04-09');
  expect(counterparts).toHaveLength(1);
  expect(counterparts[0]).toMatchObject({ id: observed!.transfer_id, transfer_id: normalId, amount: 12345 });
});

it('accepts native category normalization for transfers between on-budget accounts', async () => {
  destination = await api.createAccount({ name: 'On budget destination', offbudget: false });
  transfer = (await api.getPayees()).find((payee) => payee.transfer_acct === destination)!.id;
  await expect(
    updateTransaction(parentId, {
      subtransactions: [
        { amount: '-891.61', category, payee: transfer, notes: 'Kapitał' },
        { amount: '-1908.48', category, payee: bank, notes: 'Odsetki' },
      ],
    })
  ).resolves.toHaveLength(1);
  const parent = await getTransactionById(parentId);
  expect(parent!.subtransactions!.find((child) => child.payee === transfer)!.category).toBeNull();
  expect(parent!.subtransactions!.find((child) => child.payee === bank)!.category).toBe(category);
  expect(await api.getTransactions(destination, '2024-10-28', '2024-10-28')).toHaveLength(1);
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Keep SDK and readiness test files away from the developer's real budget.
const directory = mkdtempSync(join(tmpdir(), 'actual-conn-test-'));
process.env.ACTUAL_DATA_DIR = directory;
afterAll(() => rmSync(directory, { recursive: true, force: true }));

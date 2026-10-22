import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it('deduplicates replayed sync envelopes by timestamp with the Actual server 26.9.0 SQL', () => {
  // Exact schema/insert semantics from the tagged upstream server:
  // https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/sql/messages.sql
  // https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/sync-simple.js
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE messages_binary (timestamp TEXT PRIMARY KEY, is_encrypted BOOLEAN, content bytea)');
    const insert = db.prepare(
      'INSERT OR IGNORE INTO messages_binary (timestamp, is_encrypted, content) VALUES (?, ?, ?)'
    );
    const timestamp = '2026-09-30T12:00:00.000Z-0000-fixture';
    expect(insert.run(timestamp, 0, Buffer.from('same-message')).changes).toBe(1);
    expect(insert.run(timestamp, 0, Buffer.from('same-message')).changes).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM messages_binary').get()?.count).toBe(1);
    expect(insert.run(timestamp.replace('0000-', '0001-'), 0, Buffer.from('next-message')).changes).toBe(1);
  } finally {
    db.close();
  }
});

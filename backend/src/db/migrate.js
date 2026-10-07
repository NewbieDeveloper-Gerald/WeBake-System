/**
 * Versioned migration runner (`npm run migrate`).
 *
 * WHAT: Applies every *.sql file in migrations/ exactly once, in filename
 * order, tracking progress in the schema_migrations table.
 *
 * WHY versioned files instead of editing the DB by hand: the database schema
 * becomes code. Any environment (local, Render, a teammate's laptop) reaches
 * the same schema by running the same files in the same order. "It works on
 * my machine" schema drift becomes impossible.
 *
 * SAFETY: each file runs inside ONE transaction (BEGIN/COMMIT). If any
 * statement fails, the whole file rolls back and the version is NOT recorded,
 * so fixing the SQL and re-running is always safe.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getClient } = require('../config/db');

const MIGRATIONS_DIR = __dirname + '/migrations';

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations;');
  return new Set(rows.map((r) => r.filename));
}

async function applyFile(client, filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(fullPath, 'utf8');

  // Single transaction per file: all-or-nothing.
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1);', [filename]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_... before 002_... - filename order IS version order.

  if (files.length === 0) {
    console.log('[migrate] no migration files found.');
    return;
  }

  const client = await getClient();
  try {
    await ensureLedger(client);
    const done = await appliedSet(client);

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) {
        console.log(`[migrate] skip (already applied): ${file}`);
        continue;
      }
      console.log(`[migrate] applying: ${file} ...`);
      await applyFile(client, file);
      console.log(`[migrate] applied: ${file}`);
      applied += 1;
    }
    console.log(`[migrate] done. ${applied} new migration(s) applied.`);
  } finally {
    client.release();
  }
}

// Run when executed directly (`node src/db/migrate.js`), importable otherwise.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] FAILED:', err.message);
      process.exit(1);
    });
}

module.exports = { main };

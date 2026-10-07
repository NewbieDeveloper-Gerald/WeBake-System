/**
 * Supabase PostgreSQL connection pool.
 *
 * WHAT: A shared `pg` Pool plus three helpers: query(), getClient(), ping().
 *
 * WHY: Opening a new database connection per request is slow and exhausts
 * Supabase's connection limit. A pool reuses a small set of connections.
 * All queries MUST use $1/$2 placeholders (parameterized) so user input can
 * never become SQL - this single habit blocks SQL injection.
 */

'use strict';

const { Pool } = require('pg');
const config = require('./env');

// Prefer the pooler connection string (port 6543). The pooler is designed for
// server environments like Render that open/close connections often.
const poolConfig = config.db.connectionString
  ? { connectionString: config.db.connectionString }
  : {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
    };

const pool = new Pool({
  ...poolConfig,
  // Supabase requires SSL. rejectUnauthorized:false is the standard setting
  // for the Supabase pooler with the pg driver.
  ssl: { rejectUnauthorized: false },
  max: 10, // Cap connections: Render free + Supabase free are both small.
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  // A pooled client crashed in the background. Log it; the pool replaces it.
  console.error('[db] idle client error:', err.message);
});

/**
 * Run one parameterized query. Use for single statements (SELECT/INSERT/etc).
 * @param {string} text SQL with $1, $2 placeholders
 * @param {Array} [params] values bound to the placeholders
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const ms = Date.now() - start;
    if (config.nodeEnv !== 'production' && ms > 1000) {
      console.warn(`[db] slow query (${ms}ms): ${text.slice(0, 100)}...`);
    }
    return result;
  } catch (err) {
    // Log the SQL shape but never the params (they may contain PII/secrets).
    console.error(`[db] query failed: ${text.slice(0, 120)}... -> ${err.message}`);
    throw err;
  }
}

/**
 * Borrow a dedicated client for multi-statement TRANSACTIONS.
 * Always pair with client.release() in a finally block, or the pool leaks.
 */
async function getClient() {
  const client = await pool.connect();
  const originalRelease = client.release.bind(client);
  let released = false;

  // Safety net: warn if a caller forgets release() (connection leak detector).
  const timer = setTimeout(() => {
    if (!released) console.error('[db] LEAK: client checked out for >10s without release.');
  }, 10000);
  if (timer.unref) timer.unref();

  client.release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    return originalRelease();
  };
  return client;
}

/**
 * Lightweight health probe used by /health. Never throws.
 */
async function ping() {
  try {
    const res = await query('SELECT NOW() AS now, current_database() AS db;');
    return { connected: true, database: res.rows[0].db, timestamp: res.rows[0].now };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = { pool, query, getClient, ping };

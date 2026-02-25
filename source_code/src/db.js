'use strict';

const { Pool } = require('pg');
const Cursor = require('pg-cursor');

// ── Connection Pool ─────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected client error:', err.message);
});

/**
 * Opens a pg-cursor against the pool and yields row batches.
 * The caller is responsible for piping / writing each batch promptly to avoid
 * accumulating rows in memory.
 *
 * @param {string} sql          - Parameterised SQL query (SELECT …)
 * @param {Array}  params       - Bound parameters
 * @param {number} batchSize    - Rows per cursor read (default from env)
 * @returns {AsyncGenerator<object[]>}
 */
async function* streamRows(sql, params = [], batchSize) {
  const size = batchSize || parseInt(process.env.DB_CURSOR_BATCH_SIZE, 10) || 500;
  const client = await pool.connect();

  try {
    const cursor = client.query(new Cursor(sql, params));

    while (true) {
      const rows = await cursor.read(size);
      if (rows.length === 0) break;
      yield rows;
    }

    await cursor.close();
  } finally {
    client.release();
  }
}

/**
 * Returns a SELECT statement restricted to the caller-specified columns.
 * Column names are validated against an allowlist to prevent SQL injection.
 *
 * @param {Array<{source: string, target: string}>} columns
 * @returns {string} SQL fragment, e.g. "id, name, value"
 */
const ALLOWED_COLUMNS = new Set(['id', 'created_at', 'name', 'value', 'metadata']);

function buildSelectClause(columns) {
  const invalid = columns.filter((c) => !ALLOWED_COLUMNS.has(c.source));
  if (invalid.length) {
    throw new Error(`Invalid column(s): ${invalid.map((c) => c.source).join(', ')}`);
  }
  return columns.map((c) => `"${c.source}"`).join(', ');
}

module.exports = { pool, streamRows, buildSelectClause, ALLOWED_COLUMNS };

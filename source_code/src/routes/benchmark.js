'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');

const { streamRows } = require('../db');
const { writeCsv } = require('../writers/csvWriter');
const { writeJson } = require('../writers/jsonWriter');
const { writeXml } = require('../writers/xmlWriter');
const { writeParquet } = require('../writers/parquetWriter');

const DATASET_ROW_COUNT = 10_000_000;

// All columns to benchmark with
const ALL_COLUMNS = [
  { source: 'id',         target: 'id' },
  { source: 'created_at', target: 'created_at' },
  { source: 'name',       target: 'name' },
  { source: 'value',      target: 'value' },
  { source: 'metadata',   target: 'metadata' },
];

/**
 * Runs a single format benchmark, streaming to a temp file, and returns metrics.
 * @param {string} format
 * @returns {Promise<{format, durationSeconds, fileSizeBytes, peakMemoryMB}>}
 */
async function runBenchmark(format) {
  const tmpFile = path.join(os.tmpdir(), `benchmark-${format}-${Date.now()}`);
  const fileWriteStream = fs.createWriteStream(tmpFile);

  // Capture baseline heap
  if (global.gc) global.gc(); // hint GC if --expose-gc flag used
  let peakHeap = process.memoryUsage().heapUsed;

  // Track peak memory in a polling interval
  const memoryPoller = setInterval(() => {
    const current = process.memoryUsage().heapUsed;
    if (current > peakHeap) peakHeap = current;
  }, 100);

  const startTime = Date.now();

  try {
    const sql = `SELECT id, created_at, name, value, metadata FROM public.records ORDER BY id`;
    const rowGenerator = streamRows(sql, []);

    // Create a mock response-like object that writes to the temp file
    // This lets us reuse the exact same writer implementations
    const mockRes = Object.assign(fileWriteStream, {
      headersSent: false,
      writableEnded: false,
      setHeader: () => {},
    });

    switch (format) {
      case 'csv':
        await writeCsv(mockRes, rowGenerator, ALL_COLUMNS, false);
        break;
      case 'json':
        await writeJson(mockRes, rowGenerator, ALL_COLUMNS, false);
        break;
      case 'xml':
        await writeXml(mockRes, rowGenerator, ALL_COLUMNS, false);
        break;
      case 'parquet':
        // Parquet writer manages its own temp file and pipes to mockRes
        await writeParquet(mockRes, rowGenerator, ALL_COLUMNS);
        break;
    }

    await new Promise((resolve, reject) => {
      if (fileWriteStream.writableEnded) return resolve();
      fileWriteStream.end(resolve);
      fileWriteStream.on('error', reject);
    });
  } finally {
    clearInterval(memoryPoller);
  }

  const durationMs = Date.now() - startTime;
  const stat = fs.statSync(tmpFile);
  const fileSizeBytes = stat.size;

  // Clean up
  fs.unlink(tmpFile, () => {});

  return {
    format,
    durationSeconds: parseFloat((durationMs / 1000).toFixed(3)),
    fileSizeBytes,
    peakMemoryMB: parseFloat((peakHeap / 1024 / 1024).toFixed(2)),
  };
}

// ── GET /exports/benchmark ────────────────────────────────────────────────────
// NOTE: This route is mounted under /exports in index.js BEFORE /exports/:id
// so `benchmark` is matched as a literal path, not as an :id param.
router.get('/benchmark', async (_req, res) => {
  console.log('[benchmark] Starting full benchmark across all 4 formats...');

  const results = [];
  const formats = ['csv', 'json', 'xml', 'parquet'];

  for (const format of formats) {
    console.log(`[benchmark] Running ${format.toUpperCase()}...`);
    try {
      const result = await runBenchmark(format);
      results.push(result);
      console.log(`[benchmark] ${format.toUpperCase()} done in ${result.durationSeconds}s, ${(result.fileSizeBytes / 1e6).toFixed(1)} MB`);
    } catch (err) {
      console.error(`[benchmark] ${format} failed:`, err.message);
      results.push({
        format,
        durationSeconds: -1,
        fileSizeBytes: -1,
        peakMemoryMB: -1,
        error: err.message,
      });
    }
  }

  res.status(200).json({
    datasetRowCount: DATASET_ROW_COUNT,
    results,
  });
});

module.exports = router;

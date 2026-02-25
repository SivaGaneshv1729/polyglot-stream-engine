'use strict';

const express = require('express');
const router = express.Router();

const { createJob, getJob, updateJobStatus } = require('../jobs');
const { streamRows, buildSelectClause } = require('../db');
const { writeCsv } = require('../writers/csvWriter');
const { writeJson } = require('../writers/jsonWriter');
const { writeXml } = require('../writers/xmlWriter');
const { writeParquet } = require('../writers/parquetWriter');

const VALID_FORMATS = new Set(['csv', 'json', 'xml', 'parquet']);
const VALID_COMPRESSIONS = new Set(['gzip']);

// ── POST /exports ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { format, columns, compression } = req.body;

  // Validate format
  if (!format || !VALID_FORMATS.has(format)) {
    return res.status(400).json({
      error: 'Invalid or missing "format". Must be one of: csv, json, xml, parquet.',
    });
  }

  // Validate columns
  if (!Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({
      error: '"columns" must be a non-empty array of {source, target} objects.',
    });
  }

  for (const col of columns) {
    if (!col.source || !col.target || typeof col.source !== 'string' || typeof col.target !== 'string') {
      return res.status(400).json({
        error: 'Each column must have non-empty "source" and "target" string fields.',
      });
    }
  }

  // Validate compression
  if (compression && !VALID_COMPRESSIONS.has(compression)) {
    return res.status(400).json({
      error: 'Invalid "compression". Supported: gzip.',
    });
  }

  // Validate column names against DB allowlist (early fail before DB query)
  try {
    buildSelectClause(columns);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Parquet + gzip combination is not supported (Parquet is already compressed)
  if (format === 'parquet' && compression === 'gzip') {
    return res.status(400).json({
      error: 'Parquet format does not support gzip compression (it is already compressed).',
    });
  }

  const job = createJob({ format, columns, compression });

  return res.status(201).json({ exportId: job.exportId, status: job.status });
});

// ── GET /exports/:id/download ─────────────────────────────────────────────────
router.get('/:id/download', async (req, res) => {
  const job = getJob(req.params.id);

  if (!job) {
    return res.status(404).json({ error: 'Export job not found.' });
  }

  const selectClause = buildSelectClause(job.columns);
  const sql = `SELECT ${selectClause} FROM public.records ORDER BY id`;
  const rowGenerator = streamRows(sql, []);
  const compress = job.compression === 'gzip';

  try {
    switch (job.format) {
      case 'csv':
        await writeCsv(res, rowGenerator, job.columns, compress);
        break;
      case 'json':
        await writeJson(res, rowGenerator, job.columns, compress);
        break;
      case 'xml':
        await writeXml(res, rowGenerator, job.columns, compress);
        break;
      case 'parquet':
        await writeParquet(res, rowGenerator, job.columns);
        break;
      default:
        res.status(500).json({ error: 'Unknown format.' });
        return;
    }
    updateJobStatus(job.exportId, 'complete');
  } catch (err) {
    console.error('[exports] download error:', err.message);
    updateJobStatus(job.exportId, 'error');
    // If headers not sent yet, return error JSON; otherwise just end the stream
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed.', message: err.message });
    } else {
      res.end();
    }
  }
});

module.exports = router;

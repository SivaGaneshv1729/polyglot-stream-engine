'use strict';

const parquet = require('parquetjs-lite');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Parquet requires a seekable write target (random access), so we buffer to
// a temp file then stream the completed file to the HTTP response.
const TMP_DIR = process.env.PARQUET_TMP_DIR || '/tmp/parquet-export';

/**
 * Maps a DB column source name to a parquetjs field type.
 * @param {string} source
 * @returns {object}
 */
function getParquetFieldType(source) {
  switch (source) {
    case 'id':
      return { type: 'INT64' };
    case 'value':
      return { type: 'DOUBLE' };
    case 'created_at':
      return { type: 'TIMESTAMP_MILLIS' };
    case 'metadata':
      // Store JSON as a UTF8 string in Parquet – broadest compatibility
      return { type: 'UTF8' };
    default:
      return { type: 'UTF8' };
  }
}

/**
 * Builds a parquetjs schema from the requested columns.
 * @param {Array<{source:string, target:string}>} columns
 * @returns {parquet.ParquetSchema}
 */
function buildSchema(columns) {
  const fields = {};
  for (const col of columns) {
    fields[col.target] = getParquetFieldType(col.source);
  }
  return new parquet.ParquetSchema(fields);
}

/**
 * Streams rows as a valid Apache Parquet file.
 * Because Parquet requires seekable output, we write to a temp file first,
 * then pipe the completed file to the HTTP response.
 *
 * @param {import('http').ServerResponse} res
 * @param {AsyncGenerator<object[]>}      rowGenerator
 * @param {Array<{source:string, target:string}>} columns
 */
async function writeParquet(res, rowGenerator, columns) {
  // Parquet is already compressed (Snappy by default), so no gzip wrapper
  res.setHeader('Content-Type', 'application/vnd.apache.parquet');
  res.setHeader('Content-Disposition', 'attachment; filename="export.parquet"');

  const tmpFile = path.join(TMP_DIR, `export-${uuidv4()}.parquet`);

  try {
    // Ensure temp directory exists
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const schema = buildSchema(columns);
    const writer = await parquet.ParquetWriter.openFile(schema, tmpFile, {
      useDataPageV2: false, // broader reader compatibility
    });

    for await (const batch of rowGenerator) {
      for (const row of batch) {
        const record = {};
        for (const col of columns) {
          let val = row[col.source];
          // Coerce types for Parquet schema
          if (col.source === 'id') {
            val = BigInt(val);
          } else if (col.source === 'value') {
            val = parseFloat(val);
          } else if (col.source === 'created_at') {
            val = val instanceof Date ? val : new Date(val);
          } else if (col.source === 'metadata' && typeof val === 'object') {
            val = JSON.stringify(val);
          }
          record[col.target] = val;
        }
        await writer.appendRow(record);
      }
    }

    await writer.close();

    // Stream completed file to response
    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(tmpFile);
      readStream.on('error', reject);
      readStream.on('end', resolve);
      readStream.pipe(res);
    });
  } catch (err) {
    console.error('[parquetWriter] error:', err.message);
    if (!res.writableEnded) res.end();
  } finally {
    // Clean up temp file
    fs.unlink(tmpFile, () => {});
  }
}

module.exports = { writeParquet };

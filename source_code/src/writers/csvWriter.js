'use strict';

const { stringify } = require('csv-stringify');
const zlib = require('zlib');

/**
 * Streams the cursor rows as a CSV file directly to the HTTP response.
 * Memory usage is O(batchSize), not O(totalRows).
 *
 * @param {import('http').ServerResponse} res
 * @param {AsyncGenerator<object[]>}      rowGenerator
 * @param {Array<{source:string, target:string}>} columns
 * @param {boolean} compress - whether to gzip the output
 */
async function writeCsv(res, rowGenerator, columns, compress = false) {
  // Build header row from target column names
  const headers = columns.map((c) => c.target);

  // csv-stringify in streaming mode: accepts objects, emits CSV strings
  const csvStringifier = stringify({
    header: true,
    columns: columns.reduce((acc, c) => {
      acc[c.source] = c.target;
      return acc;
    }, {}),
    cast: {
      // Ensure JSONB metadata is serialised to a JSON string in CSV cells
      object: (value) => (value !== null ? JSON.stringify(value) : ''),
    },
  });

  // Set response headers
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="export.csv' + (compress ? '.gz"' : '"')
  );
  if (compress) res.setHeader('Content-Encoding', 'gzip');

  // Build the pipeline: csvStringifier → [gzip?] → res
  const outputStream = compress ? zlib.createGzip() : res;
  if (compress) outputStream.pipe(res);

  csvStringifier.on('error', (err) => {
    console.error('[csvWriter] stringify error:', err.message);
    if (!res.writableEnded) res.end();
  });

  // Pipe CSV → gzip → res
  if (compress) {
    csvStringifier.pipe(outputStream);
  } else {
    csvStringifier.pipe(res);
  }

  try {
    for await (const batch of rowGenerator) {
      for (const row of batch) {
        // Map source key → object to pass to csv-stringify
        const mapped = {};
        for (const col of columns) {
          mapped[col.source] = row[col.source];
        }
        // Write returns false when the buffer is full; await drain
        const ok = csvStringifier.write(mapped);
        if (!ok) await new Promise((resolve) => csvStringifier.once('drain', resolve));
      }
    }
    csvStringifier.end();
  } catch (err) {
    console.error('[csvWriter] stream error:', err.message);
    csvStringifier.destroy(err);
    if (!res.writableEnded) res.end();
  }
}

module.exports = { writeCsv };

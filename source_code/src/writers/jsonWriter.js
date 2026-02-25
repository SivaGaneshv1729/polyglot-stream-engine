'use strict';

const zlib = require('zlib');

/**
 * Streams rows as a single JSON array: [{...}, {...}, ...]
 * Writes the opening bracket, each object individually, and the closing bracket.
 * Memory usage is O(batchSize).
 *
 * @param {import('http').ServerResponse} res
 * @param {AsyncGenerator<object[]>}      rowGenerator
 * @param {Array<{source:string, target:string}>} columns
 * @param {boolean} compress
 */
async function writeJson(res, rowGenerator, columns, compress = false) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="export.json' + (compress ? '.gz"' : '"')
  );
  if (compress) res.setHeader('Content-Encoding', 'gzip');

  const sink = compress ? zlib.createGzip() : res;
  if (compress) sink.pipe(res);

  /**
   * Write a chunk to the sink, honouring back-pressure.
   * @param {string} chunk
   */
  const write = (chunk) => {
    const buf = Buffer.from(chunk, 'utf8');
    const ok = sink.write(buf);
    if (!ok) return new Promise((resolve) => sink.once('drain', resolve));
    return Promise.resolve();
  };

  let isFirst = true;

  try {
    await write('[');

    for await (const batch of rowGenerator) {
      for (const row of batch) {
        // Build target-keyed object
        const out = {};
        for (const col of columns) {
          out[col.target] = row[col.source];
        }

        const json = JSON.stringify(out);
        if (isFirst) {
          await write('\n' + json);
          isFirst = false;
        } else {
          await write(',\n' + json);
        }
      }
    }

    await write('\n]');
    sink.end();
  } catch (err) {
    console.error('[jsonWriter] stream error:', err.message);
    sink.destroy(err);
    if (!res.writableEnded) res.end();
  }
}

module.exports = { writeJson };

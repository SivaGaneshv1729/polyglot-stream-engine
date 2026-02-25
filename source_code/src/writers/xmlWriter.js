'use strict';

const zlib = require('zlib');

/**
 * Converts a JS value (including nested objects/arrays) to XML element strings.
 * @param {string} tagName
 * @param {*}      value
 * @returns {string}
 */
function valueToXml(tagName, value) {
  // Sanitise tag names (XML element names cannot start with a digit or contain spaces)
  const safe = tagName.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^(\d)/, '_$1');

  if (value === null || value === undefined) {
    return `<${safe}/>`;
  }

  if (Array.isArray(value)) {
    return `<${safe}>${value.map((v, i) => valueToXml('item', v)).join('')}</${safe}>`;
  }

  if (typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([k, v]) => valueToXml(k, v))
      .join('');
    return `<${safe}>${inner}</${safe}>`;
  }

  // Escape special XML characters
  const escaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return `<${safe}>${escaped}</${safe}>`;
}

/**
 * Streams rows as a valid XML document to the HTTP response.
 * Structure: <records><record>…</record></records>
 *
 * @param {import('http').ServerResponse} res
 * @param {AsyncGenerator<object[]>}      rowGenerator
 * @param {Array<{source:string, target:string}>} columns
 * @param {boolean} compress
 */
async function writeXml(res, rowGenerator, columns, compress = false) {
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="export.xml' + (compress ? '.gz"' : '"')
  );
  if (compress) res.setHeader('Content-Encoding', 'gzip');

  const sink = compress ? zlib.createGzip() : res;
  if (compress) sink.pipe(res);

  const write = (chunk) => {
    const ok = sink.write(chunk, 'utf8');
    if (!ok) return new Promise((resolve) => sink.once('drain', resolve));
    return Promise.resolve();
  };

  try {
    await write('<?xml version="1.0" encoding="UTF-8"?>\n<records>\n');

    for await (const batch of rowGenerator) {
      let xmlChunk = '';
      for (const row of batch) {
        xmlChunk += '  <record>\n';
        for (const col of columns) {
          xmlChunk += '    ' + valueToXml(col.target, row[col.source]) + '\n';
        }
        xmlChunk += '  </record>\n';
      }
      await write(xmlChunk);
    }

    await write('</records>');
    sink.end();
  } catch (err) {
    console.error('[xmlWriter] stream error:', err.message);
    sink.destroy(err);
    if (!res.writableEnded) res.end();
  }
}

module.exports = { writeXml };

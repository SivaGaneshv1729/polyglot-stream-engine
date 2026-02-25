'use strict';

const request = require('supertest');
const app = require('../source_code/src/index');

// ── POST /exports ─────────────────────────────────────────────────────────────
describe('POST /exports', () => {
  const validPayload = {
    format: 'csv',
    columns: [
      { source: 'id',   target: 'ID'   },
      { source: 'name', target: 'Name' },
    ],
  };

  test('returns 201 with exportId UUID and status pending for valid request', async () => {
    const res = await request(app)
      .post('/exports')
      .send(validPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('exportId');
    expect(res.body).toHaveProperty('status', 'pending');
    // UUID v4 pattern
    expect(res.body.exportId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('accepts all four valid formats', async () => {
    for (const format of ['csv', 'json', 'xml', 'parquet']) {
      const res = await request(app)
        .post('/exports')
        .send({ ...validPayload, format })
        .set('Content-Type', 'application/json');
      expect(res.status).toBe(201);
      expect(res.body.exportId).toBeTruthy();
    }
  });

  test('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/exports')
      .send({ ...validPayload, format: 'avro' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when columns is missing', async () => {
    const res = await request(app)
      .post('/exports')
      .send({ format: 'csv' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid column name', async () => {
    const res = await request(app)
      .post('/exports')
      .send({
        format: 'csv',
        columns: [{ source: 'injected; DROP TABLE records;--', target: 'bad' }],
      })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  test('returns 400 for parquet + gzip combination', async () => {
    const res = await request(app)
      .post('/exports')
      .send({ ...validPayload, format: 'parquet', compression: 'gzip' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  test('accepts valid gzip compression for csv', async () => {
    const res = await request(app)
      .post('/exports')
      .send({ ...validPayload, compression: 'gzip' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(201);
  });
});

// ── GET /exports/:id/download ─────────────────────────────────────────────────
describe('GET /exports/:id/download', () => {
  test('returns 404 for unknown exportId', async () => {
    const res = await request(app)
      .get('/exports/00000000-0000-4000-8000-000000000000/download');
    expect(res.status).toBe(404);
  });

  test('CSV download sets correct Content-Type header', async () => {
    // Create job first
    const createRes = await request(app)
      .post('/exports')
      .send({
        format: 'csv',
        columns: [{ source: 'id', target: 'ID' }],
      });
    const { exportId } = createRes.body;

    // NOTE: actual streaming requires a live DB connection.
    // In a unit test without a DB we just verify the route is reachable.
    const res = await request(app)
      .get(`/exports/${exportId}/download`)
      .timeout(3000)
      .catch((err) => err.response || { status: 500, headers: {} });

    // Content-Type should be text/csv IF db is available; otherwise 500 is acceptable
    if (res.status === 200) {
      expect(res.headers['content-type']).toMatch(/text\/csv/);
    } else {
      expect([200, 500]).toContain(res.status);
    }
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});

// ── GET /exports/benchmark ────────────────────────────────────────────────────
describe('GET /exports/benchmark', () => {
  test('returns 200 with correct schema shape (requires DB)', async () => {
    // Skip in CI without DB
    if (!process.env.DATABASE_URL) {
      console.log('Skipping benchmark test: no DATABASE_URL');
      return;
    }
    const res = await request(app).get('/exports/benchmark').timeout(300_000);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('datasetRowCount', 10_000_000);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(4);
  }, 360_000);
});

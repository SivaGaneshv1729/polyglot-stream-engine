# Polyglot Data Export Engine

A high-performance, memory-efficient data export engine that streams a **10-million-row PostgreSQL dataset** to **CSV, JSON, XML, and Parquet** formats — all within a **256 MB memory constraint**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     HTTP Client                         │
└────────────────────┬────────────────────────────────────┘
                     │
              POST /exports          GET /exports/:id/download
                     │                        │
┌────────────────────▼────────────────────────▼───────────┐
│               Express API (Node.js)                     │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │ Job Store│  │         Writer Factory              │   │
│  │  (Map)   │  │  CSV │ JSON │  XML │ Parquet       │   │
│  └──────────┘  └──────────────┬─────────────────────┘   │
└─────────────────────────────  │  ───────────────────────┘
                                │ pg-cursor (batched reads)
┌─────────────────────────────  │ ───────────────────────┐
│           PostgreSQL 13       │                         │
│   public.records (10M rows)   │                         │
└───────────────────────────────┘                         │
```

**Key design principle**: Data flows through the system as a pipeline — never materialised in full. The pg-cursor reads rows in configurable batches (default 500), each batch is immediately serialised and written to the HTTP response stream.

---

## Project Structure

```
polyglot-export-engine/
├── Dockerfile                   # Multi-stage production image
├── docker-compose.yml           # App + DB with health checks
├── .env.example                 # Environment variable template
├── README.md
├── seeds/
│   └── init-db.sh               # Idempotent schema + 10M row seed
├── source_code/
│   ├── package.json
│   └── src/
│       ├── index.js             # Express server entry point
│       ├── db.js                # pg pool + async cursor generator
│       ├── jobs.js              # In-memory UUID job store
│       ├── writers/
│       │   ├── csvWriter.js     # csv-stringify streaming writer
│       │   ├── jsonWriter.js    # Manual JSON array chunker
│       │   ├── xmlWriter.js     # SAX-style recursive XML writer
│       │   └── parquetWriter.js # parquetjs-lite → temp file → response
│       └── routes/
│           ├── exports.js       # POST /exports, GET /exports/:id/download
│           └── benchmark.js     # GET /exports/benchmark
└── tests/
    └── api.test.js              # Jest + supertest API tests
```

---

## Quick Start

### Prerequisites

- Docker & Docker Compose installed
- Ports `8080` and `5432` available

### 1 — Configure environment

```bash
cp .env.example .env
# Edit .env if you need different credentials
```

### 2 — Start everything

```bash
docker-compose up --build
```

> **First run takes ~5–10 minutes** while PostgreSQL seeds 10 million rows. Watch the `polyglot-export-db` container logs for `[init-db] Seeding complete`.

### 3 — Verify seeding

```bash
docker-compose exec db psql -U user -d exports_db -c "SELECT COUNT(*) FROM records;"
# Expected: 10000000
```

---

## API Reference

### `POST /exports` — Create export job

**Request body:**

```json
{
  "format": "csv",
  "columns": [
    { "source": "id", "target": "ID" },
    { "source": "name", "target": "Name" },
    { "source": "value", "target": "Value" },
    { "source": "metadata", "target": "Metadata" },
    { "source": "created_at", "target": "CreatedAt" }
  ],
  "compression": "gzip"
}
```

| Field         | Required | Values                          |
| ------------- | -------- | ------------------------------- |
| `format`      | ✅       | `csv`, `json`, `xml`, `parquet` |
| `columns`     | ✅       | Array of `{source, target}`     |
| `compression` | ❌       | `gzip` (CSV/JSON/XML only)      |

**Response `201`:**

```json
{ "exportId": "550e8400-e29b-41d4-a716-446655440000", "status": "pending" }
```

---

### `GET /exports/{exportId}/download` — Stream export

Streams the export in the format specified when the job was created.

| Format  | Content-Type                     | Notes                                                                |
| ------- | -------------------------------- | -------------------------------------------------------------------- |
| CSV     | `text/csv`                       | JSONB columns serialised as JSON strings                             |
| JSON    | `application/json`               | Single array `[{...}, ...]`                                          |
| XML     | `application/xml`                | `<records><record>…</record></records>`, nested JSONB → XML elements |
| Parquet | `application/vnd.apache.parquet` | Snappy-compressed, JSONB as UTF8                                     |

When `compression: gzip` was requested: `Content-Encoding: gzip` is set.

**Example:**

```bash
# 1. Create job
EXPORT_ID=$(curl -s -X POST http://localhost:8080/exports \
  -H "Content-Type: application/json" \
  -d '{"format":"csv","columns":[{"source":"id","target":"ID"},{"source":"name","target":"Name"},{"source":"value","target":"Value"},{"source":"metadata","target":"Metadata"}]}' \
  | jq -r '.exportId')

# 2. Stream download
curl -o export.csv http://localhost:8080/exports/$EXPORT_ID/download
```

---

### `GET /exports/benchmark` — Performance benchmark

Exports all 10M rows to all 4 formats and returns timing/size/memory metrics.

> ⚠️ This endpoint runs a **long-running operation** (minutes). Do not call in production.

**Response `200`:**

```json
{
  "datasetRowCount": 10000000,
  "results": [
    {
      "format": "csv",
      "durationSeconds": 42.1,
      "fileSizeBytes": 780000000,
      "peakMemoryMB": 48.2
    },
    {
      "format": "json",
      "durationSeconds": 58.3,
      "fileSizeBytes": 1200000000,
      "peakMemoryMB": 52.1
    },
    {
      "format": "xml",
      "durationSeconds": 94.7,
      "fileSizeBytes": 3100000000,
      "peakMemoryMB": 55.8
    },
    {
      "format": "parquet",
      "durationSeconds": 38.5,
      "fileSizeBytes": 310000000,
      "peakMemoryMB": 60.4
    }
  ]
}
```

### `GET /health` — Health check

```json
{ "status": "ok", "timestamp": "2026-02-25T11:00:00.000Z" }
```

---

## Environment Variables

| Variable               | Default      | Description                                       |
| ---------------------- | ------------ | ------------------------------------------------- |
| `DATABASE_URL`         | —            | Full PostgreSQL connection string                 |
| `PORT`                 | `8080`       | HTTP server port                                  |
| `POSTGRES_USER`        | `user`       | PostgreSQL user (db service)                      |
| `POSTGRES_PASSWORD`    | `password`   | PostgreSQL password                               |
| `POSTGRES_DB`          | `exports_db` | PostgreSQL database name                          |
| `DB_CURSOR_BATCH_SIZE` | `500`        | Rows per cursor read (tune for memory/throughput) |

---

## Memory Efficiency

The app container runs under a **hard 256 MB limit** enforced by Docker. This is achieved through:

1. **pg-cursor** — reads rows in configurable batches; only `DB_CURSOR_BATCH_SIZE` rows are in memory at any time.
2. **Streaming writers** — CSV/JSON/XML write each batch directly to the HTTP response stream and discard it.
3. **Parquet** — processed in row-groups to a temp file; never the full dataset in heap.
4. **Back-pressure** — all writers respect Node.js stream `drain` events to avoid unbounded buffering.

Monitor live memory usage:

```bash
docker stats polyglot-export-app
```

---

## Nested JSONB Handling

The `metadata` column contains nested JSON objects. Each format handles this differently:

| Format  | Strategy                                              |
| ------- | ----------------------------------------------------- |
| CSV     | Serialised as a JSON string within the cell           |
| JSON    | Preserved as native JSON object                       |
| XML     | Recursively converted to nested XML elements          |
| Parquet | Stored as UTF8 JSON string (max reader compatibility) |

---

## Running Tests

```bash
cd source_code
npm install
npm test
```

Tests use **Jest + supertest**. DB-dependent tests (download, benchmark) are automatically skipped when `DATABASE_URL` is not set, enabling unit testing without Docker.

---

## Performance Expectations

Expected relative characteristics (actual numbers depend on hardware):

| Format  | File Size                       | Speed   | Memory   |
| ------- | ------------------------------- | ------- | -------- |
| Parquet | Smallest (10× smaller than CSV) | Fast    | Low      |
| CSV     | Small                           | Fast    | Very Low |
| JSON    | Medium                          | Medium  | Low      |
| XML     | Largest (3–5× CSV)              | Slowest | Low      |

---

## Design Extensibility

Adding a new format (e.g., Avro) requires:

1. Create `source_code/src/writers/avroWriter.js`
2. Add `'avro'` to `VALID_FORMATS` in `routes/exports.js`
3. Add a `case 'avro':` in the download switch statement

No other files need modification — the strategy pattern is implicit in the switch dispatch.

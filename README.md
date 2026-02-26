# Polyglot Data Export Engine

A high-performance, memory-efficient data export engine that streams a **10-million-row PostgreSQL dataset** to **CSV, JSON, XML, and Parquet** formats — all within a **256 MB memory constraint**.

---

## Architecture

For a detailed explanation of the streaming pipeline, memory constraints, and format-specific implementations, please see the [Architecture Overview](docs/ARCHITECTURE.md).

---

## Project Structure

```
polyglot-export-engine/
├── docs/                        # Project documentation
│   ├── API_DOCS.md              # Detailed API endpoint reference
│   └── ARCHITECTURE.md          # Architecture & data flow diagrams
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

The engine exposes endpoints to create export jobs, stream downloads, and check system health.

For complete request/response schemas, usage examples, and benchmark details, refer to the [API Documentation](docs/API_DOCS.md).

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

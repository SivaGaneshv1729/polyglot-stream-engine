# Polyglot Data Export Engine - API Documentation

## Base URL

`http://localhost:<PORT>` (Default: `8080` or `8081` when using docker-compose default overrides)

---

## 1. Create Export Job

Creates a new export job instructing the engine which columns to extract, in what format, and with optional compression. The request is validated synchronously before returning an Export ID.

**Endpoint:** `POST /exports`

### Request Body

Content-Type: `application/json`

| Field         | Type   | Required | Description                                | Supported Values                                                                    |
| ------------- | ------ | -------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `format`      | string | **Yes**  | The output format for the exported file    | `csv`, `json`, `xml`, `parquet`                                                     |
| `columns`     | array  | **Yes**  | Array of column mapping objects            | Array of `{source: string, target: string}`                                         |
| `compression` | string | No       | Optional compression applied to the stream | `gzip` (Note: Parquet does not support gzip as it uses internal snappy compression) |

#### Example Request

```json
{
  "format": "csv",
  "columns": [
    { "source": "id", "target": "ID" },
    { "source": "name", "target": "Name" },
    { "source": "value", "target": "Value" },
    { "source": "metadata", "target": "Metadata" }
  ],
  "compression": "gzip"
}
```

### Responses

**201 Created**
When the job is successfully registered in memory.

```json
{
  "exportId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pending"
}
```

**400 Bad Request**
When validation fails (e.g., missing format, empty columns array, invalid column names not in the DB schema, or conflicting compression settings for Parquet).

```json
{
  "error": "Invalid or missing \"format\". Must be one of: csv, json, xml, parquet."
}
```

---

## 2. Download Export Job

Streams the data directly from the PostgreSQL database, through the requested formatter, to the HTTP response stream.

**Endpoint:** `GET /exports/:id/download`

### Parameters

| Name | In   | Type          | Required | Description                                                |
| ---- | ---- | ------------- | -------- | ---------------------------------------------------------- |
| `id` | path | string (UUID) | **Yes**  | The `exportId` returned from the `POST /exports` endpoint. |

### Responses

**200 OK (Application Stream)**
The response headers and content-type will vary based on the `format` requested and the `compression` settings.

| Format    | Content-Type                     |
| --------- | -------------------------------- |
| `csv`     | `text/csv`                       |
| `json`    | `application/json`               |
| `xml`     | `application/xml`                |
| `parquet` | `application/vnd.apache.parquet` |

_Note: If `compression="gzip"` was provided during job creation, the response header will also include `Content-Encoding: gzip`._

**404 Not Found**
When the `exportId` does not exist in the in-memory store.

```json
{
  "error": "Export job not found."
}
```

**500 Internal Server Error**
When an error occurs during streaming (e.g. database disconnection mid-stream). Note that if headers were already sent to the client, the stream will simply be aborted rather than sending a JSON error object.

```json
{
  "error": "Export failed.",
  "message": "Detailed error message here"
}
```

---

## 3. Run Benchmark (Development/Testing only)

Runs a synchronous multi-format benchmark against the entire dataset. It generates streams for CSV, JSON, XML, and Parquet sequentially and measures the time taken, the payload size, and the peak memory consumed during the process.

> ⚠️ **Warning:** This endpoint triggers intensive CPU and Database usage. Depending on the size of the dataset (e.g., 10 million rows), it may take several minutes to respond.

**Endpoint:** `GET /exports/benchmark`

### Responses

**200 OK**
Returns the metrics for the benchmark run.

```json
{
  "datasetRowCount": 10000000,
  "results": [
    {
      "format": "csv",
      "durationSeconds": 45.3,
      "fileSizeBytes": 750000000,
      "peakMemoryMB": 48.5
    },
    ...
  ]
}
```

---

## 4. Health Check

Used by Docker or load balancers to determine if the node application is responsive.

**Endpoint:** `GET /health`

### Responses

**200 OK**

```json
{
  "status": "ok",
  "timestamp": "2026-02-26T10:00:00.000Z"
}
```

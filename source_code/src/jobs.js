'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * In-process job store.
 * In a production system this would be backed by Redis or a DB table,
 * but for this demo an in-memory Map satisfies all requirements.
 *
 * @type {Map<string, Job>}
 *
 * @typedef {object} Job
 * @property {string}  exportId    - UUID
 * @property {string}  format      - csv | json | xml | parquet
 * @property {Array}   columns     - [{source, target}, …]
 * @property {string|null} compression - gzip | null
 * @property {string}  status      - pending | complete | error
 * @property {Date}    createdAt
 */
const store = new Map();

/**
 * Creates and stores a new export job.
 * @param {object} opts
 * @param {string}   opts.format
 * @param {Array}    opts.columns
 * @param {string|null} opts.compression
 * @returns {Job}
 */
function createJob({ format, columns, compression }) {
  const job = {
    exportId: uuidv4(),
    format,
    columns,
    compression: compression || null,
    status: 'pending',
    createdAt: new Date(),
  };
  store.set(job.exportId, job);
  return job;
}

/**
 * Retrieves a job by ID.
 * @param {string} exportId
 * @returns {Job|undefined}
 */
function getJob(exportId) {
  return store.get(exportId);
}

/**
 * Updates the status of an existing job.
 * @param {string} exportId
 * @param {'pending'|'complete'|'error'} status
 */
function updateJobStatus(exportId, status) {
  const job = store.get(exportId);
  if (job) job.status = status;
}

module.exports = { createJob, getJob, updateJobStatus };

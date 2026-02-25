#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# init-db.sh  – Idempotent schema creation + 10M row seed via PostgreSQL COPY
# Placed in /docker-entrypoint-initdb.d/ so it runs automatically on first start
# ──────────────────────────────────────────────────────────────────────────────
set -e

echo "==> [init-db] Starting database initialisation..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'

  -- ── Schema ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS public.records (
    id         BIGSERIAL                    PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE     NOT NULL DEFAULT NOW(),
    name       VARCHAR(255)                 NOT NULL,
    value      DECIMAL(18, 4)               NOT NULL,
    metadata   JSONB                        NOT NULL
  );

  -- ── Idempotent Seed (only if empty) ─────────────────────────────────────────
  DO $$
  DECLARE
    existing_count BIGINT;
  BEGIN
    SELECT COUNT(*) INTO existing_count FROM public.records;

    IF existing_count = 0 THEN
      RAISE NOTICE '[init-db] Table is empty – seeding 10,000,000 rows via COPY...';

      -- Use a temporary COPY-from-stdin approach via generate_series for speed.
      -- This is the fastest method: no Python/shell loops, pure SQL bulk insert.
      INSERT INTO public.records (name, value, metadata)
      SELECT
        'Record_' || gs::TEXT                                           AS name,
        ROUND((random() * 99999 + 1)::NUMERIC, 4)                      AS value,
        jsonb_build_object(
          'category',  (ARRAY['electronics','clothing','food','sports','books'])[floor(random()*5+1)::INT],
          'region',    (ARRAY['us-east','us-west','eu-west','ap-south','ap-east'])[floor(random()*5+1)::INT],
          'score',     ROUND((random() * 100)::NUMERIC, 2),
          'tags',      jsonb_build_array(
                         'tag_' || (floor(random()*20+1)::INT)::TEXT,
                         'tag_' || (floor(random()*20+1)::INT)::TEXT
                       ),
          'address',   jsonb_build_object(
                         'city',    'City_' || (floor(random()*1000+1)::INT)::TEXT,
                         'country', (ARRAY['US','UK','DE','IN','AU'])[floor(random()*5+1)::INT],
                         'zip',     lpad((floor(random()*99999+1)::INT)::TEXT, 5, '0')
                       )
        )                                                               AS metadata
      FROM generate_series(1, 10000000) AS gs;

      RAISE NOTICE '[init-db] Seeding complete – 10,000,000 rows inserted.';
    ELSE
      RAISE NOTICE '[init-db] Table already contains % rows – skipping seed.', existing_count;
    END IF;
  END
  $$;

EOSQL

echo "==> [init-db] Initialisation finished."

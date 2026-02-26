# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY source_code/package*.json ./

# Install ALL deps (devDeps needed for nothing here but kept for extensibility)
RUN npm install --omit=dev

# Copy source
COPY source_code/src ./src

# ─── Stage 2: Production Runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from builder (no second npm install needed)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src

# Temp directory for Parquet buffering (must be writable by appuser)
RUN mkdir -p /tmp/parquet-export && chown -R appuser:appgroup /tmp/parquet-export

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]

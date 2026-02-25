# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY source_code/package*.json ./

# Install ALL deps (including dev) for potential build steps
RUN npm install

# Copy source
COPY source_code/src ./src

# ─── Stage 2: Production Runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install only production deps in clean layer
COPY source_code/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled source from builder
COPY --from=builder /app/src ./src

# Temp directory for Parquet buffering
RUN mkdir -p /tmp/parquet-export && chown appuser:appgroup /tmp/parquet-export

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "src/index.js"]

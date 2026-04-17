# syntax=docker/dockerfile:1.7
# Multi-stage build for plexus worker

# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Production dependencies only ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- Runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security hardening (Auth-ADR requirement)
RUN addgroup -g 1001 -S plexus && \
    adduser -S plexus -u 1001 -G plexus

COPY --from=deps --chown=plexus:plexus /app/node_modules ./node_modules
COPY --from=builder --chown=plexus:plexus /app/dist ./dist
COPY --chown=plexus:plexus migrations ./migrations
COPY --chown=plexus:plexus package.json ./

USER plexus

ENV NODE_ENV=production
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PLEXUS_PORT || 8787) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]

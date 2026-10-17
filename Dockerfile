# ====================================================================
# Jinay Finance AI — Production Dockerfile
# Multi-stage build with Node.js 22 Alpine
#
# The image runs the backend API and serves frontend/public statically.
# Database schema reconciliation at start uses the same script Render
# runs (node-backend/scripts/deploy-migrate.js), so the container and the
# Render deployment follow one procedure instead of two.
# ====================================================================

FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# Copy backend dependency descriptors
COPY node-backend/package*.json ./node-backend/

# Install backend dependencies. This is a full install (not --omit=dev):
# the Prisma CLI is a devDependency and is required at container start by
# node-backend/scripts/deploy-migrate.js.
RUN cd node-backend && npm install

# Copy Prisma schema and generate the client for this platform
COPY node-backend/prisma ./node-backend/prisma
RUN cd node-backend && npx prisma generate

# Copy backend source, deploy scripts and static frontend assets
COPY node-backend/src ./node-backend/src
COPY node-backend/scripts ./node-backend/scripts
COPY frontend/public ./frontend/public

# --------------------------------------------------------------------
# Production Runner Stage
# --------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=5000

# Application tree (dependencies, generated Prisma client, source, scripts, assets).
# The backend tree is owned by the unprivileged `node` user so runtime writes
# (local-disk storage, tesseract.js CWD cache) do not require root.
COPY --chown=node:node --from=builder /app/node-backend ./node-backend
COPY --from=builder /app/frontend ./frontend

# Writable local-disk object storage (STORAGE_PROVIDER=local)
RUN mkdir -p /app/node-backend/uploads \
 && chown node:node /app/node-backend/uploads

EXPOSE 5000

# Health check (probes the same port the application listens on above)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:5000/api/v1/health || exit 1

# Drop privileges; the official node image provides the unprivileged `node` user.
USER node

# Reconcile the database schema, then start the server (mirrors Render's startCommand).
# `exec` makes node PID 1 so SIGTERM reaches the graceful-shutdown handler.
CMD ["sh", "-c", "cd node-backend && node scripts/deploy-migrate.js && exec node src/server.js"]

# ====================================================================
# Jinay Finance AI — Production Dockerfile
# Multi-stage build with Node.js 22 Alpine
# ====================================================================

FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# Copy root and backend dependency descriptors
COPY package*.json ./
COPY node-backend/package*.json ./node-backend/

# Install dependencies
RUN npm install --omit=dev || true
RUN mkdir -p /app/node_modules
RUN cd node-backend && npm install

# Copy Prisma schema and generate client
COPY node-backend/prisma ./node-backend/prisma
RUN cd node-backend && npx prisma generate

# Copy source code and frontend assets
COPY node-backend/src ./node-backend/src
COPY frontend/public ./frontend/public

# --------------------------------------------------------------------
# Production Runner Stage
# --------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=5000

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node-backend ./node-backend
COPY --from=builder /app/frontend ./frontend

EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:5000/api/v1/health || exit 1

# Start production server
CMD ["node", "node-backend/src/server.js"]

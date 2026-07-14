# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production

# Run as the unprivileged user that ships with the node image
USER node

EXPOSE 3000

# Liveness check against the public health endpoint. (Readiness — which checks
# Mongo+Redis — is /health/ready and should be wired to the orchestrator's
# readinessProbe / LB target group, not the container healthcheck.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

# PROCESS MODEL:
# Default = one Node process per container (one event loop). Scale horizontally
# by running many replicas behind a websocket-aware load balancer — the
# Socket.IO Redis adapter already makes that cluster-safe. This is the
# recommended model for Kubernetes (set replicas / HPA; one process per pod
# keeps CPU accounting and the Mongo pool math simple).
#
# Alternatively run the in-box cluster (one worker per core) by overriding the
# command to: node src/cluster.js  — and set CLUSTER_WORKERS + size
# MONGO_CONTAINER_POOL_BUDGET so pool×workers stays under the Atlas cap.
CMD ["node", "src/server.js"]

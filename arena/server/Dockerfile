# Arena game server (Colyseus, run with tsx — no compile step needed).
# Build context is the WORKSPACE ROOT (./arena) so npm workspaces resolve
# @nimbo/shared. Only shared + server SOURCE is copied; the client and
# loadtest manifests are copied for the lockfile install but their code
# is not (the server never imports them).
FROM node:20-alpine

WORKDIR /app

# 1) Manifests first, so `npm ci` is cached until a dependency changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY loadtest/package.json loadtest/
RUN npm ci

# 2) Only the code the server actually runs.
COPY shared shared
COPY server server

WORKDIR /app/server

# Debts and the anti-replay ledger live on a mounted volume (see
# docker-compose) so they survive container restarts — a restart must
# not forget who was paid or which deposit signatures were spent.
ENV OUTBOX_FILE=/data/settlement-outbox.jsonl
ENV DEPOSIT_LOG_FILE=/data/consumed-deposits.jsonl
ENV REPORTS_FILE=/data/death-reports.jsonl
# AF.1 — the round-rotation request queue. Durable for the same reason
# as the outbox: a restart between "asked to open round N+1" and "the
# chain confirmed it" must resume waiting for THAT round, not pick a
# different one and open a second vault beside it.
ENV ROUND_OPS_FILE=/data/round-ops.jsonl

EXPOSE 2567
CMD ["npx", "tsx", "src/index.ts"]

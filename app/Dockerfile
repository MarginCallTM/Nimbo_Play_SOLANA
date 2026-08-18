# AF.2 — the Nimbo Play portal (Next.js) as a container.
#
# Build context is app/ (see docker-compose). Three stages so the image
# that actually runs carries neither the source nor the build toolchain.
#
# ⚠ NEXT_PUBLIC_* ARE BAKED AT BUILD TIME. Next inlines them into the
# client bundle, exactly like VITE_SERVER_URL in the game client — they
# are build ARGs here, NOT runtime env. Changing the RPC, the program id
# or the round id means REBUILDING this image, not restarting it.

# --- deps: install once, cached until package-lock.json changes -------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci (not install): installs the EXACT lockfile tree, and fails loudly
# if the lockfile and package.json disagree — a deploy is not the place to
# silently resolve a new dependency version.
RUN npm ci

# --- build: compile the app into .next/standalone ---------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_PROGRAM_ID
ARG NEXT_PUBLIC_RPC_ENDPOINT
ARG NEXT_PUBLIC_ROUND_ID
ENV NEXT_PUBLIC_PROGRAM_ID=$NEXT_PUBLIC_PROGRAM_ID
ENV NEXT_PUBLIC_RPC_ENDPOINT=$NEXT_PUBLIC_RPC_ENDPOINT
ENV NEXT_PUBLIC_ROUND_ID=$NEXT_PUBLIC_ROUND_ID
# Telemetry off: a build server phoning home is noise we did not ask for.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- runtime: the standalone server, nothing else ---------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root: this container is reachable from the internet through Caddy.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone/ holds server.js + the pruned node_modules. static/ and
# public/ are NOT included in it by design — Next expects them beside it.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

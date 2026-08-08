# Arena web client — built to static files by Vite, served by nginx.
# Build context is the WORKSPACE ROOT (./arena) for @nimbo/shared.
#
# CRITICAL: VITE_SERVER_URL is baked in at BUILD time (Vite inlines
# import.meta.env). The image is therefore tied to one server URL — a
# VPS deploy must build with its public address. docker-compose passes
# it as a build arg from .env, so `docker compose up --build` rebakes it.
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY loadtest/package.json loadtest/
RUN npm ci

COPY shared shared
COPY client client

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build --workspace client

# --- serve stage: just static files -----------------------------------
FROM nginx:alpine
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80

# Settlement service (Rust) — pays extractions & refunds to wallets.
# Build context is the REPO ROOT (the Cargo workspace lives there). The
# `backend` member is copied only so cargo can parse the workspace; it is
# NOT compiled (`cargo build -p settlement` builds settlement alone).
FROM rust:1-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Manifests + sources needed for workspace resolution + the build.
COPY Cargo.toml Cargo.lock ./
COPY settlement settlement
COPY backend backend

RUN cargo build --release -p settlement

# --- runtime stage: just the binary + TLS roots -----------------------
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/settlement /usr/local/bin/settlement

# The authority keypair is MOUNTED read-only at this path (see
# docker-compose); AUTHORITY_KEYPAIR points the service at it. It is a
# secret that signs real payouts — never bake it into the image.
ENV AUTHORITY_KEYPAIR=/keys/authority.json

CMD ["settlement"]

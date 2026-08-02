// A3.1 — server side of SIWS: nonce issuance + token verification.
//
// Module-level (not per-room) on purpose: Colyseus 0.17 recommends a
// STATIC onAuth — authentication happens before any room instance is
// involved, so the nonce store cannot live on the room.

import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    parseSiwsMessage,
    type AuthChallenge,
    type AuthTokenPayload,
} from "@nimbo/shared";
import { randomBytes } from "node:crypto";

// The domain the signed message MUST name. Phantom fills it with the
// requesting page's host and refuses mismatches on its side too — this
// server-side check is what makes the property hold for NON-wallet
// clients (bots build the message themselves).
export const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";

// Outstanding challenges: nonce -> expiry (unix ms). Single-use and
// short-lived: consumed on first presentation, dead after the TTL.
// In-memory is fine for one process; a multi-node deployment would
// move this to Redis (noted for APROD.7).
const NONCE_TTL_MS = 2 * 60 * 1000;
const nonces = new Map<string, number>();

export function issueChallenge(): AuthChallenge {
    // lazy sweep: forgotten challenges die here, no timer needed
    const now = Date.now();
    for (const [nonce, expiresAt] of nonces) {
        if (expiresAt <= now) nonces.delete(nonce);
    }
    const nonce = randomBytes(16).toString("hex"); // 128 bits: unguessable
    const expiresAt = now + NONCE_TTL_MS;
    nonces.set(nonce, expiresAt);
    return { nonce, expiresAt };
}

function consumeNonce(nonce: string): boolean {
    const expiresAt = nonces.get(nonce);
    if (expiresAt === undefined) return false;
    nonces.delete(nonce); // single-use: gone even if expired
    return expiresAt > Date.now();
}

// Verify a client's auth token. Returns the wallet address (base58)
// on success, undefined on ANY failure — the caller rejects, and we
// log the reason server-side only (never help an attacker probe).
export function verifyAuthToken(token: unknown): string | undefined {
    if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
        return fail("missing or oversized token");
    }

    let payload: AuthTokenPayload;
    try {
        payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    } catch {
        return fail("token is not base64 JSON");
    }
    if (
        typeof payload?.pk !== "string" ||
        typeof payload?.msg !== "string" ||
        typeof payload?.sig !== "string"
    ) {
        return fail("malformed payload");
    }

    let publicKey: Uint8Array;
    try {
        publicKey = bs58.decode(payload.pk);
    } catch {
        return fail("public key is not base58");
    }
    const message = new Uint8Array(Buffer.from(payload.msg, "base64"));
    const signature = new Uint8Array(Buffer.from(payload.sig, "base64"));
    if (publicKey.length !== 32 || signature.length !== 64 || message.length === 0) {
        return fail("bad key/signature/message length");
    }

    // 1) cryptographic proof: the holder of pk signed exactly msg
    if (!nacl.sign.detached.verify(message, signature, publicKey)) {
        return fail("signature does not verify");
    }

    // 2) the SIGNED TEXT must say what we require. Checking the token's
    // fields would prove nothing — only what the key actually signed
    // binds the wallet to this domain and this nonce.
    const parsed = parseSiwsMessage(Buffer.from(message).toString("utf8"));
    if (!parsed) return fail("unparseable SIWS message");
    if (parsed.domain !== AUTH_DOMAIN) return fail(`wrong domain "${parsed.domain}"`);
    if (parsed.address !== payload.pk) return fail("message address != signing key");

    // 3) freshness: the nonce must be ours, alive, and never seen —
    // consumed atomically so a captured token replays exactly zero times
    if (!consumeNonce(parsed.nonce)) return fail("unknown, expired or reused nonce");

    return payload.pk;
}

function fail(reason: string): undefined {
    console.log(`[auth] rejected: ${reason}`);
    return undefined;
}

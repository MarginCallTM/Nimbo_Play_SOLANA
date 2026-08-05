// A3.1 — adversarial probe of the SIWS door (the auth counterpart of
// tests/arena.ts failure cases: a lock is only proven by trying it).
// Each scenario is an attack the door MUST stop; the honest join is
// the control proving the door still opens for legitimate players.
//
// A4.2a — retargeted at the LOBBY: since D72 the arena also demands a
// verified deposit, so every arena join is rejected regardless of the
// SIWS token — the probe could no longer tell the door it was
// testing. The lobby is the SIWS-only door now (same verifyAuthToken
// on both, so the lock proven here is the lock the arena uses too).
//
// Usage: npx tsx src/auth-attack.ts   (server must be running)

import { Client } from "@colyseus/sdk";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    LOBBY_ROOM,
    PROTOCOL_VERSION,
    SIWS_STATEMENT,
    buildSiwsMessage,
    type AuthChallenge,
    type AuthTokenPayload,
    type JoinOptions,
} from "@nimbo/shared";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";
const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";
const options: JoinOptions = { protocol: PROTOCOL_VERSION, name: "probe", stake: 0 };

async function freshNonce(): Promise<string> {
    const res = await fetch(`${SERVER_URL}/auth/challenge`);
    const challenge: AuthChallenge = await res.json();
    return challenge.nonce;
}

interface ForgeOpts {
    domain?: string;   // lie about the domain
    signWith?: nacl.SignKeyPair; // sign with a DIFFERENT key than claimed
}

async function forgeToken(opts: ForgeOpts = {}): Promise<string> {
    const keys = nacl.sign.keyPair();
    const address = bs58.encode(keys.publicKey);
    const message = buildSiwsMessage({
        domain: opts.domain ?? AUTH_DOMAIN,
        address,
        statement: SIWS_STATEMENT,
        nonce: await freshNonce(),
    });
    const messageBytes = new TextEncoder().encode(message);
    const signer = opts.signWith ?? keys;
    const payload: AuthTokenPayload = {
        pk: address,
        msg: Buffer.from(messageBytes).toString("base64"),
        sig: Buffer.from(nacl.sign.detached(messageBytes, signer.secretKey)).toString("base64"),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// Attempt a join; resolve with what happened instead of throwing, so
// the scenario table below reads as assertions.
async function tryJoin(token: string | undefined): Promise<"accepted" | "rejected"> {
    const client = new Client(SERVER_URL);
    if (token !== undefined) client.auth.token = token;
    try {
        const room = await client.joinOrCreate(LOBBY_ROOM, options);
        await room.leave();
        return "accepted";
    } catch {
        return "rejected";
    }
}

let failures = 0;
async function expect(name: string, got: Promise<"accepted" | "rejected">, want: string) {
    const result = await got;
    const ok = result === want;
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${result} (want ${want})`);
}

// control first: the door must OPEN for an honest signature
await expect("honest signed join", tryJoin(await forgeToken()), "accepted");
await expect("no token at all", tryJoin(undefined), "rejected");
await expect("garbage token", tryJoin("bm90LWEtdG9rZW4="), "rejected");

// replay: capture a valid token, use it twice — the nonce died with
// the first (successful) use
const captured = await forgeToken();
await expect("first use of token", tryJoin(captured), "accepted");
await expect("REPLAYED token", tryJoin(captured), "rejected");

// phishing: a perfectly valid signature… naming someone else's domain
await expect("wrong domain", tryJoin(await forgeToken({ domain: "evil.example" })), "rejected");

// identity theft: claim wallet A, sign with wallet B
await expect(
    "signature by another key",
    tryJoin(await forgeToken({ signWith: nacl.sign.keyPair() })),
    "rejected",
);

console.log(failures === 0 ? "\nall scenarios behaved" : `\n${failures} FAILING scenario(s)`);
process.exit(failures === 0 ? 0 : 1);

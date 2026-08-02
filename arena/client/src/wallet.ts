// A3.1 — browser side of SIWS, MVP scope: Phantom's injected provider
// only. The wallet-standard registry (multi-wallet discovery) is the
// portal's job (ARENA-5); the arena client stays framework-free.
//
// The `signIn` method IS the SIWS standard: we hand Phantom the fields
// (domain, statement, nonce), Phantom builds the canonical message,
// shows the user a real "Sign in" dialog — not a scary hex blob — and
// refuses if our domain doesn't match the page. Signing is free: no
// transaction, nothing on chain, no fees.

import { SIWS_STATEMENT, type AuthChallenge, type AuthTokenPayload } from "@nimbo/shared";

// Minimal typing of what Phantom injects — only what we use. The
// INJECTED provider returns a flat shape ({ address, ... }) while the
// wallet-standard feature nests it ({ account: { address } }); we saw
// the flat one in the wild (2026-08-02), so tolerate both. The address
// itself may be a base58 string or a PublicKey-like object.
interface SignInOutput {
    account?: { address: string };
    address?: string | { toBase58?: () => string };
    publicKey?: string | { toBase58?: () => string };
    signedMessage: Uint8Array; // the exact bytes that were signed
    signature: Uint8Array;     // 64-byte ed25519 signature
}

function extractAddress(out: SignInOutput): string | undefined {
    const raw = out.account?.address ?? out.address ?? out.publicKey;
    if (typeof raw === "string") return raw;
    return raw?.toBase58?.();
}
interface PhantomProvider {
    signIn?: (input: {
        domain: string;
        statement: string;
        nonce: string;
    }) => Promise<SignInOutput>;
}

function toBase64(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

// Full sign-in round trip: challenge -> wallet signature -> auth token
// for the Colyseus join. Throws with a user-readable message on any
// failure (surfaced in the status bar).
export async function signInWithSolana(serverUrl: string): Promise<string> {
    const provider = (window as { phantom?: { solana?: PhantomProvider } }).phantom?.solana;
    if (!provider?.signIn) {
        throw new Error("Phantom wallet not found — install/update Phantom to play");
    }

    // 1) the server chooses the nonce, never us: that is what makes a
    // captured signature worthless a second time
    const res = await fetch(`${serverUrl}/auth/challenge`);
    if (!res.ok) throw new Error(`auth challenge failed (${res.status})`);
    const challenge: AuthChallenge = await res.json();

    // 2) wallet dialog: the user reads the statement and approves
    const out = await provider.signIn({
        domain: window.location.host,
        statement: SIWS_STATEMENT,
        nonce: challenge.nonce,
    });

    const address = extractAddress(out);
    if (!address) {
        // surface the real shape so the next provider quirk is a
        // console read, not a guessing game
        console.error("[siws] unexpected signIn output shape:", out);
        throw new Error("Phantom signIn returned an unexpected response shape");
    }

    // 3) pack the proof; the server re-verifies EVERYTHING (the token
    // is a claim, not a credential, until onAuth says so)
    const payload: AuthTokenPayload = {
        pk: address,
        msg: toBase64(out.signedMessage),
        sig: toBase64(out.signature),
    };
    return btoa(JSON.stringify(payload));
}

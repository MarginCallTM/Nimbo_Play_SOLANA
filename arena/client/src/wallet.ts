// A3.1 — browser side of SIWS, MVP scope: Phantom's injected provider
// only. The wallet-standard registry (multi-wallet discovery) is the
// portal's job (ARENA-5); the arena client stays framework-free.
//
// The `signIn` method IS the SIWS standard: we hand Phantom the fields
// (domain, statement, nonce), Phantom builds the canonical message,
// shows the user a real "Sign in" dialog — not a scary hex blob — and
// refuses if our domain doesn't match the page. Signing is free: no
// transaction, nothing on chain, no fees.

import {
    SIWS_STATEMENT,
    buildJoinInstruction,
    type AuthChallenge,
    type AuthTokenPayload,
    type RoundInfoResponse,
} from "@nimbo/shared";
import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
} from "@solana/web3.js";

// Public devnet RPC: fine for a dev client (rate limits and all).
// A production client goes through a paid endpoint (Helius/QuickNode).
const DEVNET_RPC = "https://api.devnet.solana.com";

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
    // set after signIn/connect — the wallet currently in charge
    publicKey?: { toBase58(): string } | null;
    // Phantom signs AND submits to the cluster selected in the wallet
    // UI — one dialog, one atomic step (safer than signTransaction +
    // our own send: no window where a signed tx sits in JS memory)
    signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
}

function getProvider(): PhantomProvider {
    const provider = (window as { phantom?: { solana?: PhantomProvider } }).phantom?.solana;
    if (!provider) {
        throw new Error("Phantom wallet not found — install/update Phantom to play");
    }
    return provider;
}

// A4.11 — the connected wallet, best-effort (undefined if not connected
// or Phantom absent). Tags a death REPORT so a wronged tester can be
// refunded by address. Never throws — a report is purely diagnostic.
export function currentWallet(): string | undefined {
    try {
        return getProvider().publicKey?.toBase58();
    } catch {
        return undefined;
    }
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
    const provider = getProvider();
    if (!provider.signIn) {
        throw new Error("Phantom too old — update it to get signIn support");
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

// A3.2 — the deposit: build the join instruction ourselves (shared/
// encodes it byte-exactly), let Phantom sign AND send it, wait for
// confirmation, and hand back the signature. That signature is the
// client's PROOF OF DEPOSIT: the server will read the tx from the
// chain and verify everything before the snake spawns.
// AF.1 — the signature ALONE is no longer enough for the caller: with
// several rounds alive during a rotation, the join has to name the round
// this very transaction funded. Returning both together is what makes
// that impossible to get wrong — re-reading GET /round after the deposit
// could hand back a successor that took over in the meantime.
export interface JoinDeposit {
    signature: string;
    roundId: string;
}

export async function sendJoinDeposit(
    serverUrl: string,
    stakeSol: number,
): Promise<JoinDeposit> {
    const provider = getProvider();
    if (!provider.publicKey || !provider.signAndSendTransaction) {
        throw new Error("wallet not connected — sign in first");
    }
    const player = new PublicKey(provider.publicKey.toBase58());

    // The SERVER owns the round coordinates (which round is live,
    // where the rake goes) — asking it beats hardcoding a round id
    // that goes stale every 24h.
    const res = await fetch(`${serverUrl}/round`);
    if (!res.ok) throw new Error(`round info failed (${res.status})`);
    const round: RoundInfoResponse = await res.json();

    // Client-side rounding is fine: the server re-reads the EXACT
    // lamports from the confirmed tx, not from what we claim here.
    const stakeLamports = BigInt(Math.round(stakeSol * LAMPORTS_PER_SOL));

    const connection = new Connection(DEVNET_RPC, "confirmed");
    const tx = new Transaction().add(
        buildJoinInstruction({
            player,
            roundId: BigInt(round.roundId),
            treasury: new PublicKey(round.treasury),
            stakeLamports,
        }),
    );
    tx.feePayer = player;
    // A blockhash gives the tx a ~60s validity window; keeping its
    // lastValidBlockHeight lets confirmTransaction DETECT expiry
    // instead of polling forever for a tx that can no longer land.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    const { signature } = await provider.signAndSendTransaction(tx);

    const conf = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
    );
    if (conf.value.err) {
        throw new Error(`deposit tx failed on-chain: ${JSON.stringify(conf.value.err)}`);
    }
    // round.roundId, NOT a fresh fetch: this is the round the bytes above
    // actually paid into.
    return { signature, roundId: round.roundId };
}

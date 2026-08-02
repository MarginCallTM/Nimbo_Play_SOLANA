// A3.1 — Sign-In With Solana (SIWS): prove wallet ownership WITHOUT a
// transaction. A Solana wallet is an ed25519 keypair; signing an
// arbitrary message with it costs nothing and touches no funds, yet
// anyone holding the public key can verify the signature. SIWS is a
// standard (adopted by wallet-standard, supported by Phantom) that
// fixes the MESSAGE FORMAT so wallets can display a proper "sign in"
// dialog instead of a scary hex blob — and enforce that the domain in
// the message matches the site asking (anti-phishing).
//
// The proof the client presents is bound to:
//  - a NONCE the server issued (single-use, short TTL): a captured
//    signature cannot be replayed to open a second session,
//  - the DOMAIN: a signature harvested by a phishing site names the
//    wrong domain and is rejected here,
//  - the ADDRESS: the message itself names the key that must verify.
//
// This lives in shared/ because THREE parties handle the same text:
// the browser client (Phantom builds it from our input), the headless
// loadtest bots (they build it themselves — no wallet UI), and the
// server (it parses and verifies it).

// Shown by the wallet in the sign-in dialog. Keep it honest: this
// authenticates a session, it never moves funds. ASCII only: the SIWS
// ABNF (inherited from EIP-4361) forbids non-ASCII in the statement,
// and Phantom rejects the whole request as "invalid format".
export const SIWS_STATEMENT =
    "Sign in to Nimbo Play. This only proves you own this wallet: no transaction, no fees.";

export interface SiwsFields {
    domain: string;   // host of the site requesting the sign-in
    address: string;  // base58 wallet public key
    statement: string;
    nonce: string;    // server-issued, single-use
    issuedAt?: string; // ISO 8601
}

// Canonical SIWS message layout (ABNF from the spec, the subset we
// use). Wallets derive exactly this text from the sign-in input.
export function buildSiwsMessage(f: SiwsFields): string {
    let msg = `${f.domain} wants you to sign in with your Solana account:\n${f.address}`;
    msg += `\n\n${f.statement}`;
    msg += `\n\nNonce: ${f.nonce}`;
    if (f.issuedAt) msg += `\nIssued At: ${f.issuedAt}`;
    return msg;
}

// Tolerant parse: wallets may append fields we did not ask for (URI,
// Version, Chain ID…). Security only hangs on three things — domain,
// address, nonce — so we extract those and ignore the rest.
export interface ParsedSiws {
    domain: string;
    address: string;
    nonce: string;
}

const HEADER_SUFFIX = " wants you to sign in with your Solana account:";

export function parseSiwsMessage(message: string): ParsedSiws | undefined {
    const lines = message.split("\n");
    if (lines.length < 2 || !lines[0].endsWith(HEADER_SUFFIX)) return undefined;
    const domain = lines[0].slice(0, -HEADER_SUFFIX.length);
    const address = lines[1];
    const nonceLine = lines.find((l) => l.startsWith("Nonce: "));
    if (!domain || !address || !nonceLine) return undefined;
    return { domain, address, nonce: nonceLine.slice("Nonce: ".length) };
}

// What travels in the Colyseus auth token (base64-encoded JSON): the
// claimed key, the signed message and its signature. The server trusts
// NONE of it until the signature verifies and the message checks out.
export interface AuthTokenPayload {
    pk: string;  // base58 public key (the claimed wallet)
    msg: string; // base64 signed message bytes
    sig: string; // base64 ed25519 signature (64 bytes)
}

// The server's answer to GET /auth/challenge.
export interface AuthChallenge {
    nonce: string;
    expiresAt: number; // unix ms — informative; the server re-checks
}

// A4.6 money red-team (2026-08-07) — putting a price on desertion.
//
// The hole this closes. D81's two-step ready-check protects the honest
// player from the AFK partner, but it protects nobody from a DELIBERATE
// one. Queueing is free (SIWS only, no money), accepting is free, and a
// deserter's only punishment was `removeFromLobby` — a socket close they
// re-open instantly with a fresh nonce. So the loop
//   queue -> get matched -> accept -> never deposit -> requeue
// costs the attacker nothing and runs forever. What it costs the victim
// depends on where they are in the ritual:
//   - still in the accept step: 15s of their evening, repeatedly, and
//     nobody in that queue ever reaches a game;
//   - already deposited: their stake is now sitting behind the launch
//     gate bleeding the 60s refund clock, and the refund does NOT return
//     the on-chain rake (D77, documented). Every cycle takes 5.5% of the
//     honest player's stake and hands the attacker a bill of zero.
// Denial of matchmaking plus a rake pump, at the cost of a websocket.
//
// The answer is a cooldown, not a ban (D78: we police abuse, not play).
// The FIRST desertion is free on purpose — a dropped connection, a
// closed laptop and a misclick are all indistinguishable from malice at
// n=1, and punishing them would make the honest player pay for the
// attacker's design. Repetition is what is not free, and the escalation
// is steep enough that the loop above dies while a real player who
// rage-quit once and came back never notices it exists.
//
// Wallet-keyed, so it survives a reconnect (the only identity the lobby
// has). Multi-wallet Sybil defeats it — that is A4.4's problem, and this
// at least makes the attack cost one funded wallet per parallel slot
// instead of one socket.

// Strikes decay: a wallet that behaves for this long starts clean. The
// window is longer than the escalation ladder so a griefer cannot idle
// just under it.
const STRIKE_DECAY_MS = 30 * 60 * 1000;

// Cooldown by strike count (1st = free). Capped at the last entry.
const COOLDOWN_MS = [0, 0, 60_000, 5 * 60_000, 15 * 60_000];

interface Record {
    strikes: number;
    lastStrikeAt: number;
    blockedUntil: number;
}

const records = new Map<string, Record>();

function currentRecord(wallet: string, now: number): Record | undefined {
    const record = records.get(wallet);
    if (!record) return undefined;
    if (now - record.lastStrikeAt > STRIKE_DECAY_MS && now >= record.blockedUntil) {
        records.delete(wallet); // served their time and behaved since
        return undefined;
    }
    return record;
}

// Called when a wallet is the reason a pending match fell apart:
// declined, walked out, or let a window expire without acting.
export function recordDesertion(wallet: string): void {
    const now = Date.now();
    const record = currentRecord(wallet, now) ?? { strikes: 0, lastStrikeAt: 0, blockedUntil: 0 };
    record.strikes += 1;
    record.lastStrikeAt = now;
    const penalty = COOLDOWN_MS[Math.min(record.strikes, COOLDOWN_MS.length - 1)];
    record.blockedUntil = now + penalty;
    records.set(wallet, record);
    if (penalty > 0) {
        console.log(
            `[lobby] ${wallet.slice(0, 4)}.. desertion #${record.strikes}` +
            ` — queue closed for ${Math.round(penalty / 1000)}s`,
        );
    }
}

// A wallet that completes the ritual has earned its record back: a
// player who genuinely disconnected once and then played a real match
// carries nothing forward.
export function clearDesertions(wallet: string): void {
    records.delete(wallet);
}

// Seconds still to serve, 0 if the queue is open to this wallet.
export function cooldownRemainingS(wallet: string): number {
    const now = Date.now();
    const record = currentRecord(wallet, now);
    if (!record || now >= record.blockedUntil) return 0;
    return Math.ceil((record.blockedUntil - now) / 1000);
}

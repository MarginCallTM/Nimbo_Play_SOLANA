// A4.2a morceau 2 — the FREE matchmaking queue in front of the paid
// arena (D77 + D81). NOT a security gate: the arena's real door stays
// the verified deposit in ITS onAuth — anyone can still pay and walk
// in directly. The lobby's job is coordination: nobody should ever
// deposit before a match is all but certain, because the on-chain
// rake taken at join cannot be refunded.
//
// Every player in this room is in exactly one of three states:
//   queued     -> in line (position synced, head = next served)
//   accepting  -> pending match, free ACCEPT click open (D81, 15s)
//   depositing -> everyone accepted: deposit window open (D77, 30s)
// And leaves it through exactly one of three exits:
//   fulfilled  -> their VERIFIED deposit spawned in the arena
//                 (reported by the registry, never claimed by the client)
//   requeued   -> a partner deserted: back to the HEAD of the queue,
//                 having paid nothing (D77)
//   dropped    -> they were the deserter (decline, AFK, no deposit)

import { Room, type Client } from "colyseus";
import { MapSchema, Schema, type } from "@colyseus/schema";
import {
    LOBBY_ACCEPT_SECONDS,
    LOBBY_DEPOSIT_SECONDS,
    MIN_LIVE_PLAYERS,
    PROTOCOL_VERSION,
    type DepositNowMessage,
    type JoinOptions,
    type LobbyStatus,
    type MatchCancelledMessage,
    type MatchFoundMessage,
} from "@nimbo/shared";
import { verifyAuthToken } from "../auth";
import { hasJoinableArena, onDepositorJoined } from "../arena-registry";
import { clearDesertions, cooldownRemainingS, recordDesertion } from "../lobby-conduct";

export class LobbyPlayer extends Schema {
    @type("string") name = "";
    @type("string") status: LobbyStatus = "queued";
    // 1-based place in line; 0 while in a pending match
    @type("uint8") position = 0;

    // NOT synced: the wallet stays between the player and the server
    // (same privacy rule as the arena's Player)
    wallet = "";
}

export class LobbyState extends Schema {
    @type({ map: LobbyPlayer }) players = new MapSchema<LobbyPlayer>();
}

interface PendingMember {
    sessionId: string;
    wallet: string;
    accepted: boolean;
    fulfilled: boolean; // verified deposit spawned in the arena
}

interface PendingMatch {
    members: PendingMember[];
    phase: "accept" | "deposit";
    secondsLeft: number;
}

export class LobbyRoom extends Room<{ state: LobbyState }> {
    state = new LobbyState();
    maxClients = 64;

    private queue: string[] = []; // sessionIds, head first
    private matches: PendingMatch[] = [];
    private unsubscribeJoins?: () => void;

    messages = {
        // D81 — the free click. Only meaningful during an accept phase.
        accept: (client: Client) => {
            const match = this.matchOf(client.sessionId);
            if (!match || match.phase !== "accept") return;
            const member = match.members.find((m) => m.sessionId === client.sessionId);
            if (!member) return;
            member.accepted = true;
            if (match.members.every((m) => m.accepted)) this.openDeposits(match);
        },
        // Explicit desertion: partners go back to the head of the
        // queue NOW instead of waiting out the timer.
        decline: (client: Client) => {
            const match = this.matchOf(client.sessionId);
            if (!match) return;
            this.resolve(match, (m) => m.sessionId === client.sessionId, "declined");
        },
    };

    // SIWS only (A3.1): identity, zero money. Only the ARENA ever
    // verifies a deposit.
    static async onAuth(token: string, options: JoinOptions) {
        if (options.protocol !== PROTOCOL_VERSION) {
            throw new Error("protocol mismatch: refresh your browser");
        }
        const wallet = verifyAuthToken(token);
        if (!wallet) throw new Error("sign-in required: connect your wallet");
        // A4.6 (2026-08-07) — repeat deserters wait. Enforced HERE, at
        // the door, so a griefer's reconnect costs a round trip and not
        // a queue slot. Says how long, on purpose: a real player who
        // dropped once deserves to understand what happened, and a
        // griefer learns nothing from it he could not time himself.
        const cooldown = cooldownRemainingS(wallet);
        if (cooldown > 0) {
            throw new Error(`you left a pending match — the queue reopens in ${cooldown}s`);
        }
        return { wallet };
    }

    onCreate(_options: JoinOptions) {
        console.log("[lobby] room up");
        // 1Hz: this room coordinates humans, not physics
        this.setSimulationInterval(() => this.lobbyTick(), 1000);
        this.unsubscribeJoins = onDepositorJoined((wallet) => this.onFulfilled(wallet));
    }

    onJoin(client: Client, options: JoinOptions, auth: { wallet: string }) {
        // One lobby seat per wallet: two tabs of the same wallet could
        // otherwise be PAIRED AGAINST EACH OTHER — the cheapest self-
        // match. (Multi-wallet Sybil remains: A4.4 territory.)
        for (const p of this.state.players.values()) {
            if (p.wallet === auth.wallet) {
                throw new Error("this wallet is already in the lobby");
            }
        }
        const player = new LobbyPlayer();
        player.name = options.name || "anonymous";
        player.wallet = auth.wallet;
        this.state.players.set(client.sessionId, player);
        this.queue.push(client.sessionId);
        this.syncPositions();
        console.log(
            `[lobby] +${client.sessionId} wallet=${auth.wallet.slice(0, 4)}..` +
            ` queue=${this.queue.length}`,
        );
    }

    onLeave(client: Client) {
        const match = this.matchOf(client.sessionId);
        // clean up FIRST so resolve() sees the leaver as gone
        // (no message to send, nothing to re-queue)
        this.state.players.delete(client.sessionId);
        this.queue = this.queue.filter((id) => id !== client.sessionId);
        if (match) {
            const member = match.members.find((m) => m.sessionId === client.sessionId);
            // a fulfilled member's socket closing is the normal end of
            // their lobby chapter, not desertion
            if (member && !member.fulfilled) {
                this.resolve(match, (m) => m.sessionId === client.sessionId, "a player left");
            }
        }
        this.syncPositions();
        console.log(`[lobby] -${client.sessionId} queue=${this.queue.length}`);
    }

    onDispose() {
        this.unsubscribeJoins?.();
        console.log("[lobby] disposed");
    }

    // ---- the 1Hz heart ------------------------------------------------

    private lobbyTick() {
        // 1. age pending matches (iterate a copy: resolve() mutates)
        for (const match of [...this.matches]) {
            match.secondsLeft -= 1;
            if (match.secondsLeft > 0) continue;
            if (match.phase === "accept") {
                this.resolve(match, (m) => !m.accepted, "accept window expired");
            } else {
                this.resolve(match, (m) => !m.fulfilled, "deposit window expired");
            }
        }

        // 2. DRAIN — D77 "gate at launch only": a joinable arena (live,
        // or waiting with a lone depositor) takes the head of the queue
        // directly. No accept step: there is no partner to coordinate,
        // and the waiting depositor's 60s refund clock is running.
        // One per tick on purpose: the snapshot's depositor count only
        // moves when someone actually spawns, so a burst-drain could
        // overshoot the room's capacity.
        if (this.queue.length >= 1 && hasJoinableArena()) {
            this.startMatch([this.queue.shift()!], "deposit");
        }

        // 3. PAIR — no joinable arena: form fresh cohorts of
        // MIN_LIVE_PLAYERS from the front of the queue.
        while (this.queue.length >= MIN_LIVE_PLAYERS) {
            this.startMatch(this.queue.splice(0, MIN_LIVE_PLAYERS), "accept");
        }

        this.syncPositions();
    }

    private startMatch(sessionIds: string[], phase: "accept" | "deposit") {
        const match: PendingMatch = {
            members: sessionIds.map((sessionId) => ({
                sessionId,
                wallet: this.state.players.get(sessionId)!.wallet,
                accepted: phase === "deposit", // solo fast-path: nothing to accept
                fulfilled: false,
            })),
            phase,
            secondsLeft: phase === "accept" ? LOBBY_ACCEPT_SECONDS : LOBBY_DEPOSIT_SECONDS,
        };
        this.matches.push(match);
        for (const m of match.members) {
            const p = this.state.players.get(m.sessionId)!;
            p.status = phase === "accept" ? "accepting" : "depositing";
            p.position = 0;
            if (phase === "accept") {
                const msg: MatchFoundMessage = { seconds: LOBBY_ACCEPT_SECONDS };
                this.sendTo(m.sessionId, "matchFound", msg);
            } else {
                const msg: DepositNowMessage = { seconds: LOBBY_DEPOSIT_SECONDS };
                this.sendTo(m.sessionId, "depositNow", msg);
            }
        }
        console.log(`[lobby] match ${phase} — ${sessionIds.join(", ")}`);
    }

    // D81 — everyone clicked: NOW the money is asked for.
    private openDeposits(match: PendingMatch) {
        match.phase = "deposit";
        match.secondsLeft = LOBBY_DEPOSIT_SECONDS;
        for (const m of match.members) {
            const p = this.state.players.get(m.sessionId);
            if (p) p.status = "depositing";
            const msg: DepositNowMessage = { seconds: LOBBY_DEPOSIT_SECONDS };
            this.sendTo(m.sessionId, "depositNow", msg);
        }
        console.log("[lobby] all accepted — deposit window open");
    }

    // The arena reported a verified deposit spawn. Fires for EVERY
    // arena join (direct joiners included) — only pending members match.
    private onFulfilled(wallet: string) {
        for (const match of this.matches) {
            const member = match.members.find((m) => m.wallet === wallet && !m.fulfilled);
            if (!member) continue;
            member.fulfilled = true;
            // completing the ritual clears any desertion record: a
            // player who genuinely dropped once and then deposited into
            // a real match carries no strike forward (lobby-conduct's
            // contract — the cooldown punishes the loop, not the run).
            clearDesertions(wallet);
            // their lobby chapter is over: free the seat (and the
            // one-wallet-one-seat guard) right away
            this.removeFromLobby(member.sessionId);
            if (match.members.every((m) => m.fulfilled)) {
                this.matches = this.matches.filter((m2) => m2 !== match);
                console.log("[lobby] match complete — all deposits spawned");
            }
            return;
        }
    }

    // A pending match falls apart — the ONE dissolution path, fed by
    // four causes (decline, leave, accept expiry, deposit expiry) that
    // differ only in who the deserters are. Deserters are dropped from
    // the lobby; innocents go back to the HEAD of the queue in their
    // original order, having paid nothing (D77). Members already
    // fulfilled are in the arena's waiting phase: the drain will route
    // the next queue member to them, and the 60s waiting refund
    // (morceau 1) is their safety net.
    private resolve(
        match: PendingMatch,
        isDeserter: (m: PendingMember) => boolean,
        reason: string,
    ) {
        this.matches = this.matches.filter((m) => m !== match);

        const present = (m: PendingMember) => this.state.players.has(m.sessionId);
        const innocents = match.members.filter((m) => !m.fulfilled && !isDeserter(m) && present(m));
        for (let i = innocents.length - 1; i >= 0; i--) {
            const m = innocents[i];
            this.queue.unshift(m.sessionId);
            this.state.players.get(m.sessionId)!.status = "queued";
            const msg: MatchCancelledMessage = { requeued: true, reason };
            this.sendTo(m.sessionId, "matchCancelled", msg);
        }

        for (const m of match.members) {
            if (m.fulfilled || !isDeserter(m)) continue;
            // The strike lands whether or not they are still connected:
            // "close the socket" IS one of the desertion moves, and it
            // is the one that leaves present() false (onLeave clears the
            // player before calling us). Punishing only the deserters
            // polite enough to stay would be a strange rule.
            recordDesertion(m.wallet);
            if (!present(m)) continue;
            const msg: MatchCancelledMessage = { requeued: false, reason };
            this.sendTo(m.sessionId, "matchCancelled", msg);
            this.removeFromLobby(m.sessionId);
        }

        this.syncPositions();
        console.log(`[lobby] match dissolved (${reason})`);
    }

    // ---- plumbing -----------------------------------------------------

    private matchOf(sessionId: string): PendingMatch | undefined {
        return this.matches.find((m) => m.members.some((mm) => mm.sessionId === sessionId));
    }

    private sendTo(sessionId: string, type: string, payload: unknown) {
        this.clients.find((c) => c.sessionId === sessionId)?.send(type, payload);
    }

    private removeFromLobby(sessionId: string) {
        this.state.players.delete(sessionId);
        this.queue = this.queue.filter((id) => id !== sessionId);
        this.clients.find((c) => c.sessionId === sessionId)?.leave();
    }

    private syncPositions() {
        this.queue.forEach((sessionId, i) => {
            const p = this.state.players.get(sessionId);
            if (p) p.position = i + 1;
        });
    }
}

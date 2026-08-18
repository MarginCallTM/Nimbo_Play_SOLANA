// A4.11.b — durable, append-only log of the SERVER's version of every
// death. The counterpart of reports.ts: a player report is what the
// CLIENT believed, this is what the server actually resolved. Judging a
// "that was unfair" claim means putting the two side by side.
//
// Why a file and not just console.log. The [death-geo] line has existed
// since A4.9, but it only lives in the container's stdout — and there is
// no log rotation configured, so the choice was between reading it the
// same day or letting it grow without bound. Neither survives contact
// with real players reporting a death from last week. This file lives on
// the same durable volume as the outbox and the reports.
//
// Diagnostic ONLY: nothing here feeds back into the simulation, and no
// money moves on it. Refunds stay manual (Decision 2A, devnet).

import { appendFileSync } from "fs";

const DEATH_LOG_FILE = process.env.DEATH_LOG_FILE ?? "./death-geo.jsonl";

// One row per death. Deliberately flat (grep- and jq-friendly) and
// named after what an operator asks: who, killed by whom, how far, how
// laggy were BOTH sides.
export interface DeathRecord {
    at: string;              // ISO, so a report timestamp can be matched
    room: string;
    kind: "collision" | "head-on" | "border";
    victim: string;          // display name — reports are filed by pseudo
    victimId: string;
    victimScore: number;
    // A4.11.b — BOTH latencies. The victim's alone was never enough: a
    // laggy KILLER is the case that produces a body rendered 50-75px
    // behind where the server has it, and it was invisible until now.
    victimRttMs?: number;
    killerRttMs?: number;
    boosting: boolean;       // a boosting snake covers ~8px per tick
    // collision / head-on only
    killer?: string;
    killerId?: string;
    hitHead?: boolean;       // head-on-head vs into a body segment
    dist?: number;           // victim head -> hit segment
    reach?: number;          // sum of radii: contact happens below this
    victimTurn?: number;     // angle gap: client body recon diverges most
    killerTurn?: number;     //   in sharp turns — the A4.9 "pretzel" tell
    // border only
    fromCentre?: number;     // hypot(x, y)
    limit?: number;          // WORLD_RADIUS - radius: the lethal ring
    // THE number for a border dispute: how far PAST the lethal ring the
    // server saw the head. A few px = they really clipped it. Tens of px
    // = the server had them deep outside while their screen showed them
    // inside, which is the shape of a genuine unfair death.
    over?: number;
}

export function recordDeath(record: DeathRecord): void {
    try {
        appendFileSync(DEATH_LOG_FILE, JSON.stringify(record) + "\n");
    } catch (err) {
        // Diagnostics must never take a game down: a full disk or a bad
        // path costs us the trace, not the round.
        console.error(`[death-log] write failed: ${(err as Error).message}`);
    }
}

export function deathLogFilePath(): string {
    return DEATH_LOG_FILE;
}

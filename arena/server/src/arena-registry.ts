// A4.2a — the lobby's window onto the arena side. Two services:
//   1. hasJoinableArena(): is there a game the head of the queue can
//      complete RIGHT NOW (D77 "gate at launch only")?
//   2. deposit spawns: the arena reports every VERIFIED deposit that
//      actually spawned — the lobby marks ready-check members
//      fulfilled on this signal, never on a client's claim.
//
// Module-level on purpose (same pattern as auth.ts nonces): all rooms
// live in this one process at MVP scale. Multi-process sharding will
// need the matchmaker/presence APIs instead (APROD.7).

import type { ArenaPhase } from "@nimbo/shared";

export interface ArenaSnapshot {
    phase: ArenaPhase;
    connectedDepositors: number; // frozen (A1.9) snakes don't count
    capacity: number;
}

// The room hands us a GETTER, not a value: the registry always reads
// fresh state, the room never has to remember to push updates.
const rooms = new Map<string, () => ArenaSnapshot>();
const joinListeners = new Set<(wallet: string) => void>();

export function registerArenaRoom(roomId: string, snapshot: () => ArenaSnapshot) {
    rooms.set(roomId, snapshot);
}

export function unregisterArenaRoom(roomId: string) {
    rooms.delete(roomId);
}

export function notifyDepositorJoined(wallet: string) {
    for (const listener of joinListeners) listener(wallet);
}

// Returns the unsubscribe function (the lobby calls it on dispose).
export function onDepositorJoined(listener: (wallet: string) => void): () => void {
    joinListeners.add(listener);
    return () => joinListeners.delete(listener);
}

// D77 "gate at launch only": an arena with at least one connected
// depositor takes queue members directly, no pairing needed — LIVE
// (you fall into the ongoing game), or still WAITING behind the
// launch gate (a lone waiting depositor is the best possible
// destination for the next player: you complete their pair).
export function hasJoinableArena(): boolean {
    for (const snapshot of rooms.values()) {
        const s = snapshot();
        if (s.connectedDepositors >= 1 && s.connectedDepositors < s.capacity) {
            return true;
        }
    }
    return false;
}

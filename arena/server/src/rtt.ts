// A4.0 — server-authoritative round-trip time, per client.
//
// The existing ping/pong (ArenaRoom.messages.ping) is CLIENT-measured:
// the client stamps its own clock, the server echoes, the client does
// the math and shows it on the HUD. Fine for a HUD, useless for a gate —
// a client can report any number it likes. RTT is about to decide who
// may enter a REAL-MONEY room (the ping gate), and later how far to
// rewind a lethal collision (lag compensation). Both must be unspoofable.
//
// So the server stamps the ping with ITS OWN monotonic clock, the client
// echoes the stamp back verbatim (srvping -> srvpong), and the whole
// round trip is measured on the server clock. The client never supplies
// a duration, only bounces a token it cannot usefully alter.

import { performance } from "node:perf_hooks";

const SMOOTHING = 0.2;    // EWMA weight on each fresh sample
const MAX_SANE_MS = 2000; // a backgrounded tab echoes late garbage — drop it

export class RttTracker {
    private rtt = new Map<string, number>();

    // Feed a returned srvpong. `stamp` is exactly the value the server
    // sent on the matching srvping; now - stamp is the true round trip.
    record(sessionId: string, stamp: unknown): void {
        if (typeof stamp !== "number" || !Number.isFinite(stamp)) return;
        const sample = performance.now() - stamp;
        if (sample < 0 || sample > MAX_SANE_MS) return;
        const prev = this.rtt.get(sessionId);
        this.rtt.set(
            sessionId,
            prev === undefined ? sample : prev * (1 - SMOOTHING) + sample * SMOOTHING,
        );
    }

    // Smoothed RTT in ms, or undefined until the first srvpong lands.
    get(sessionId: string): number | undefined {
        return this.rtt.get(sessionId);
    }

    forget(sessionId: string): void {
        this.rtt.delete(sessionId);
    }

    // The stamp to put on an outgoing srvping — the server's monotonic
    // clock, so it survives wall-clock (NTP) steps.
    static stamp(): number {
        return performance.now();
    }
}

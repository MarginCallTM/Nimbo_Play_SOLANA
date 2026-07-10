"use client";

import { useEffect, useState } from "react";

// Live countdown to an ABSOLUTE deadline (a Unix timestamp in SECONDS, the
// unit the on-chain `Lottery.end_timestamp` uses). Returns the number of
// seconds left, recomputed every tick from the real clock — NOT a counter we
// decrement. Why absolute-vs-now instead of "counter - 1" each second:
//   - self-correcting: if the browser tab sleeps and the interval misses a
//     few ticks, the next tick still shows the TRUE remaining time.
//   - anchored to the wall clock, so it matches what the chain will enforce.
//
// SSR note: `null` until the component has mounted in the browser. The server
// renders HTML once (at request time) and the client "hydrates" it; if our
// first client render used Date.now() it would differ from the server's value
// and React would flag a hydration mismatch. Staying null until mounted lets
// callers render a stable placeholder ("—:—:—") on that first paint.
export function useCountdown(endTimestampSec: number | null | undefined) {
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

    useEffect(() => {
        // No deadline yet (account still loading) → stay in the null state.
        if (endTimestampSec == null) {
            setSecondsLeft(null);
            return;
        }

        // Pure function: TRUE remaining seconds from the real clock, floored
        // at 0 (never negative once the deadline has passed).
        const compute = () =>
            Math.max(0, endTimestampSec - Math.floor(Date.now() / 1000));

        // First value right away (this runs on the client, post-hydration, so
        // Date.now() is safe here).
        setSecondsLeft(compute());

        const id = setInterval(() => setSecondsLeft(compute()), 1000);
        // Cleanup: clears the interval when the deadline changes or the
        // component unmounts. Skip this and every remount stacks a new timer.
        return () => clearInterval(id);
    }, [endTimestampSec]);

    return {
        secondsLeft,
        // Not ready yet (still null): callers show a placeholder.
        ready: secondsLeft !== null,
        // Deadline reached. False while null so we don't flash "closed"
        // before the first real value.
        expired: secondsLeft === 0,
    };
}

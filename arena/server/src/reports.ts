// A4.11 — durable, append-only log of player-submitted death reports.
//
// Diagnostic ONLY: the server never acts on a report automatically. It
// records each one verbatim (plus a receive time) for the operator to
// read by hand. The workflow: a tester clicks "report this death", the
// client's reconstruction (its own head + every in-view snake, as the
// CLIENT rendered them AND as the server's synced state had them) lands
// here; the operator cross-references the client-vs-server gap against
// the [death-geo] log line and, if the death was genuinely unfair,
// refunds the wallet manually (off-chain, devnet — no money-path code).
//
// Path defaults local; in Docker the Dockerfile points REPORTS_FILE at
// /data so reports survive container recreation (same as the outbox).

import { appendFileSync } from "fs";

const REPORTS_FILE = process.env.REPORTS_FILE ?? "./death-reports.jsonl";

export function recordReport(report: unknown): void {
    appendFileSync(
        REPORTS_FILE,
        JSON.stringify({ receivedAt: new Date().toISOString(), report }) + "\n",
    );
}

export function reportsFilePath(): string {
    return REPORTS_FILE;
}

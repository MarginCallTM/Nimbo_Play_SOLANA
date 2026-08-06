// A4.6 RED-TEAM ÉCONOMIQUE — the wallet fleet.
//
// The money-path bots (sparring.ts with SPAR_WALLETS set) each need a
// real funded devnet wallet: SIWS proves they own it, the join deposit
// spends from it, extractions and refunds flow back to it through the
// settlement service. This script makes that fleet exist:
//
//   1. ensures wallets/bot-01.json .. bot-NN.json exist (generated on
//      first run, REUSED forever after — the fleet keeps its history,
//      and settlement payouts land on wallets we still control)
//   2. tops every wallet up to the target balance from the FUNDER
//      (default: ~/.config/solana/id.json, the dev wallet), asking the
//      devnet faucet for more only when the funder itself runs short
//      (airdrops are rate-limited; transfers from one funded wallet
//      are not — hence funder-redistributes, not airdrop-per-bot)
//
// Usage (from arena/):
//   npm run fleet             6 wallets topped up to 0.5 SOL each
//   npm run fleet 8 0.3       8 wallets, 0.3 SOL each
//
// The wallets/ directory holds PRIVATE KEYS (devnet-only, but still):
// it is gitignored, and these wallets must never touch mainnet.

import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const DIR =
    process.env.FLEET_DIR ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "wallets");
const COUNT = Number(process.argv[2] ?? 6);
const TARGET_SOL = Number(process.argv[3] ?? 0.5);

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 32) {
    console.error(`bad wallet count "${process.argv[2]}" — expected an integer 1..32`);
    process.exit(1);
}
if (!(TARGET_SOL > 0) || TARGET_SOL > 5) {
    console.error(`bad target "${process.argv[3]}" — expected SOL in (0, 5]`);
    process.exit(1);
}

const connection = new Connection(RPC_URL, "confirmed");
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

function loadKeypair(file: string): Keypair {
    return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))),
    );
}

function walletFile(idx: number): string {
    return path.join(DIR, `bot-${String(idx + 1).padStart(2, "0")}.json`);
}

(async () => {
    // --- 1) the fleet exists ---------------------------------------
    fs.mkdirSync(DIR, { recursive: true });
    const bots: Keypair[] = [];
    for (let i = 0; i < COUNT; i += 1) {
        const file = walletFile(i);
        if (!fs.existsSync(file)) {
            const fresh = Keypair.generate();
            fs.writeFileSync(file, JSON.stringify(Array.from(fresh.secretKey)));
            console.log(`[fleet] generated ${path.basename(file)} = ${fresh.publicKey.toBase58()}`);
        }
        bots.push(loadKeypair(file));
    }

    // --- 2) everyone reaches the target ----------------------------
    const funderPath =
        process.env.FUNDER_KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
    const funder = loadKeypair(funderPath);

    const target = Math.round(TARGET_SOL * LAMPORTS_PER_SOL);
    const balances = await Promise.all(
        bots.map((b) => connection.getBalance(b.publicKey)),
    );
    const shortfall = balances.reduce((sum, b) => sum + Math.max(0, target - b), 0);
    const FEE_HEADROOM = 0.01 * LAMPORTS_PER_SOL;

    let funderBalance = await connection.getBalance(funder.publicKey);
    console.log(
        `[fleet] funder ${funder.publicKey.toBase58().slice(0, 4)}.. holds ${sol(funderBalance)} SOL,` +
        ` fleet shortfall ${sol(shortfall)} SOL`,
    );
    // the faucet is the LAST resort: rate-limited per address/IP, and
    // a top-up loop hammering it just gets 429s
    while (funderBalance < shortfall + FEE_HEADROOM) {
        console.log("[fleet] funder short — asking the devnet faucet for 2 SOL…");
        try {
            const sig = await connection.requestAirdrop(funder.publicKey, 2 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(sig, "confirmed");
            funderBalance = await connection.getBalance(funder.publicKey);
        } catch (err) {
            console.error(`[fleet] airdrop refused (${(err as Error).message})`);
            console.error("[fleet] fund the funder manually (https://faucet.solana.com) and re-run");
            process.exit(1);
        }
    }

    for (let i = 0; i < COUNT; i += 1) {
        const missing = target - balances[i];
        if (missing <= 0) continue;
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: funder.publicKey,
                toPubkey: bots[i].publicKey,
                lamports: missing,
            }),
        );
        await sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
        console.log(`[fleet] topped up bot-${String(i + 1).padStart(2, "0")} +${sol(missing)} SOL`);
    }

    // --- report ----------------------------------------------------
    console.log("\n[fleet] ready:");
    for (let i = 0; i < COUNT; i += 1) {
        const balance = await connection.getBalance(bots[i].publicKey);
        console.log(
            `  bot-${String(i + 1).padStart(2, "0")}  ${bots[i].publicKey.toBase58()}  ◎${sol(balance)}`,
        );
    }
    console.log(`\nnext: SPAR_WALLETS=wallets SPAR_STAKE=0.1 npm run spar hunt:2 racoon:2`);
})();

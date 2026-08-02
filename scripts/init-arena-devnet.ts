// A3.2 — one-shot devnet bootstrap for the arena program.
//
// Two steps, both idempotent (safe to re-run):
//  1) initialize_reserve — MUST run right after the first deploy: the
//     first caller becomes the reserve authority (squatting window).
//     If the reserve already exists we just print its authority.
//  2) initialize_round — opens a long-lived dev round (24h) that the
//     game server will verify join deposits against. Prints the
//     ROUND_ID to put in the server's environment.
//
// Run: yarn ts-mocha -p ./tsconfig.json -t 1000000 scripts/init-arena-devnet.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Arena } from "../target/types/arena";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

const RAKE_BPS = 550; // 5.5% house rake
const RESERVE_BPS = 200; // 2% pellet fund
const ROUND_DURATION_S = 24 * 3600; // dev round: long enough to not fight expiry

describe("init arena devnet", () => {
    it("initializes the reserve (if needed) and opens a dev round", async () => {
        const connection = new anchor.web3.Connection(
            "https://api.devnet.solana.com",
            "confirmed"
        );

        // Same wallet that deployed the program: it becomes reserve
        // authority AND round authority (MVP: hot wallet; a dedicated
        // server keypair comes with the settlement service, A3.3)
        const secret = JSON.parse(
            fs.readFileSync(os.homedir() + "/.config/solana/id.json", "utf8")
        );
        const keypair = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret));
        const wallet = new anchor.Wallet(keypair);

        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: "confirmed",
        });
        anchor.setProvider(provider);

        const idl = JSON.parse(fs.readFileSync("./target/idl/arena.json", "utf8"));
        const program = new Program<Arena>(idl as Arena, provider);

        console.log("Program id:", program.programId.toBase58());
        console.log("Payer     :", wallet.publicKey.toBase58());

        // --- 1) FoodReserve singleton -------------------------------
        const [reservePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("food_reserve")],
            program.programId
        );

        const existing = await connection.getAccountInfo(reservePda);
        if (existing === null) {
            const sig = await program.methods
                .initializeReserve()
                .accountsPartial({
                    payer: wallet.publicKey,
                    reserve: reservePda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            console.log("reserve initialized", reservePda.toBase58(), "tx", sig);
        } else {
            const reserve = await program.account.foodReserve.fetch(reservePda);
            console.log("reserve already exists:", reservePda.toBase58());
            console.log("authority:", reserve.authority.toBase58());
            if (!reserve.authority.equals(wallet.publicKey)) {
                throw new Error(
                    "reserve authority is NOT our wallet - someone squatted it"
                );
            }
        }

        // --- 2) Dev round --------------------
        // Deadline compared on-chain against Clock::get(): derive it from
        // the VALIDATOR clock, not the machine's (same rule as the tests.)
        const slot = await connection.getSlot();
        const chainNow = await connection.getBlockTime(slot);
        if (chainNow === null) throw new Error("validator returned no block time");

        // Chain time as round id: unique per run, human-readable enough.
        const roundId = new anchor.BN(chainNow);
        const roundBytes = roundId.toArrayLike(Buffer, "le", 8);
        const [round] = PublicKey.findProgramAddressSync(
            [Buffer.from("round"), roundBytes],
            program.programId
        );
        const [vault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), roundBytes],
            program.programId
        );

        const endTs = new anchor.BN(chainNow + ROUND_DURATION_S);
        const sig = await program.methods
            .initializeRound(
                roundId,
                endTs,
                wallet.publicKey, // round authority (settles extractions)
                wallet.publicKey, // treasury (rake destination - self on devnet)
                RAKE_BPS, 
                RESERVE_BPS
            )
            .accountsPartial({
                payer: wallet.publicKey,
                round,
                vault,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        console.log("round opened, tx", sig);
        console.log("ROUND_ID", roundId.toString());
        console.log("round PDA:", round.toBase58());
        console.log("vault PDA", vault.toBase58());
        console.log("ends at : ", new Date(endTs.toNumber() * 1000).toISOString());
        console.log(
            "Explorer :",
            `https://explorer.solana.com/address/${round.toBase58()}?cluster=devnet`
        );
    });
});
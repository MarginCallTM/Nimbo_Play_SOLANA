// A3.5 — daily round closure: sweep the expired round's residual vault
// balance (the ORPHAN SOL, D50) into the persistent FoodReserve, and
// flip the round to Ended (closes join/inject/settle in one stroke).
//
// Idempotent and safe by construction: the program refuses a round
// that is not Open or whose deadline has not passed — this script can
// only ever do the one legal thing.
//
// Run: ROUND_ID=<id> yarn ts-mocha -p ./tsconfig.json -t 1000000 scripts/end-round-devnet.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Arena } from "../target/types/arena";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

describe("end round devnet", () => {
    it("sweeps the expired round's orphan SOL into the FoodReserve", async () => {
        const raw = process.env.ROUND_ID;
        if (!raw) throw new Error("ROUND_ID env required: which round to end?");
        const roundId = new anchor.BN(raw);

        const connection = new anchor.web3.Connection(
            "https://api.devnet.solana.com",
            "confirmed"
        );
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

        const roundBytes = roundId.toArrayLike(Buffer, "le", 8);
        const [round] = PublicKey.findProgramAddressSync(
            [Buffer.from("round"), roundBytes],
            program.programId
        );
        const [vault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), roundBytes],
            program.programId
        );
        const [reserve] = PublicKey.findProgramAddressSync(
            [Buffer.from("food_reserve")],
            program.programId
        );

        // pre-flight: show what we are about to do, refuse the obvious
        const state = await program.account.round.fetch(round);
        if ("ended" in state.state) {
            console.log(`round ${roundId} is already Ended — nothing to do`);
            return;
        }
        const vaultBefore = await connection.getBalance(vault);
        const reserveBefore = await connection.getBalance(reserve);
        console.log(`round ${roundId}: Open, vault holds ${vaultBefore / 1e9} SOL`);
        console.log(`reserve before: ${reserveBefore / 1e9} SOL`);

        const sig = await program.methods
            .endRound()
            .accountsPartial({
                authority: wallet.publicKey,
                round,
                vault,
                reserve,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        const reserveAfter = await connection.getBalance(reserve);
        const swept = (reserveAfter - reserveBefore) / 1e9;
        console.log(`round ended, tx ${sig}`);
        console.log(`swept ${swept} SOL -> reserve now ${reserveAfter / 1e9} SOL`);
        console.log(
            "Explorer :",
            `https://explorer.solana.com/tx/${sig}?cluster=devnet`
        );
    });
});

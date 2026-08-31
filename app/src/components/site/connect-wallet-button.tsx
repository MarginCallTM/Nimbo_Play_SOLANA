"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

// "7xKq9fPa…kQ8w" -> "7xKq…kQ8w" (base58 is safe to slice for display).
function shortAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function ConnectWalletButton() {
    const { publicKey, connecting, disconnect } = useWallet();
    const { setVisible } = useWalletModal();

    // Hydration guard: the server always renders the disconnected state, so
    // the FIRST client render must match it. Real wallet state only after
    // mount (autoConnect may connect instantly on the client).
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // publicKey presence IS the connection state - no need for `connected`.
    const isConnected = mounted && publicKey !== null;

    // The idle label is rendered as two spans instead of one string so CSS can
    // shorten it to "Connect" on narrow screens, where the header also has to
    // fit the wordmark and the menu toggle. Doing it in CSS rather than from a
    // width read in JS keeps the server and client markup identical — a
    // JS-chosen label would hydrate wrong on the first paint.
    const idleLabel = (
        <>
            Connect<span className="hidden md:inline">&nbsp;wallet</span>
        </>
    );

    const label = !mounted
        ? idleLabel
        : publicKey
            ? shortAddress(publicKey.toBase58())
            : connecting
                ? "Connecting..."
                : idleLabel;

    const handleClick = () => {
        if (publicKey) {
            disconnect();
        } else {
            setVisible(true); // open the wallet -selection modal
        }
    };

    return (
        <button
        type="button"
        onClick={handleClick}
        title={isConnected ? "Click to disconnect" : undefined}
        // F5.4 — solid white pill, matching the reference header and the hero's
        // primary CTA. The old brand-gradient fill was calibrated for a light
        // page; on the new black it read as a floating blue blob.
        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[1.02]"
        >
          <span
            className={`size-1.5 rounded-full ${isConnected ? "bg-success" : "bg-black/40"}`}
          />
          {label}
        </button>
    );
}
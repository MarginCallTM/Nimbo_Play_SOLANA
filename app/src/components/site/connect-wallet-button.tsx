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

    const label = !mounted
        ? "Connect wallet"
        : publicKey
            ? shortAddress(publicKey.toBase58())
            : connecting
                ? "Connecting..."
                : "Connect wallet";
    
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
        className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground cta-glow"
        style={{ background: "var(--gradient-brand)" }}
        >
          <span
            className={`size-1.5 rounded-full ${isConnected ? "bg-success" : "bg-white/90"}`}
          />
          {label}
        </button>
    );
}
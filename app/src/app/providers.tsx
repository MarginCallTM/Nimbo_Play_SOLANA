"use client";

import { useMemo, type ReactNode } from "react";
import {
    ConnectionProvider,
    WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_ENDPOINT } from "@/lib/constants";

// Default stylesheet for the wallet-selection modal. Loaded once here;
// we can override it with our own tokens later (10.6).
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: {children: ReactNode}) {
    // Empty on purpose: modern wallets (Phantom, Solflare, Backpack...)
    // announce themselves via the wallet Standard and are auto-detected.
    // useMemo keeps the array reference stable across re-renders. a new
    // array each render would make WalletProvider re-initialize.
    const wallets = useMemo(() => [], []);

    return (
        <ConnectionProvider endpoint={RPC_ENDPOINT}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
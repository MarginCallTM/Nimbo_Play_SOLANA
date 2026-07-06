"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
    ConnectionProvider,
    WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

    // One QueryClient per mount (useState initializer runs once), never a
    // module-level singleton: with SSR that would leak cached data between
    // requests/users. Defaults tuned for a public devnet RPC: data stays
    // "fresh" 10s (no refetch storm), no refetch on window focus.
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 10_000,
                        refetchOnWindowFocus: false,
                    },
                },
            }),
    );

    return (
        <ConnectionProvider endpoint={RPC_ENDPOINT}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <QueryClientProvider client={queryClient}>
                        {children}
                    </QueryClientProvider>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}

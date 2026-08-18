import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AF.2 — Docker deployment. "standalone" makes `next build` emit a
  // self-contained .next/standalone/ with its own minimal server.js and
  // ONLY the node_modules actually reached by the code. Without it the
  // runtime image has to carry the full dependency tree (Solana +
  // wallet-adapter + particles is hundreds of MB); with it the final
  // image stays small enough to rebuild on the VPS in seconds.
  output: "standalone",
  turbopack: {
    // This project lives in a subfolder of a larger repo (Anchor/backend at the
    // root). Pin Turbopack's root to this app dir so it doesn't infer the repo
    // root from the sibling yarn.lock.
    root: __dirname,
  },
};

export default nextConfig;

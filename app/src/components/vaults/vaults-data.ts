// Vault page mock data + shared helpers.
// ALL numbers here are fabricated marketing mocks (10.15); they get replaced
// by real on-chain reads in 10.17. NOTE: the on-chain program runs ONE round
// at a time — two "live" vaults (daily + weekly) is a UI fiction to resolve
// in 10.17 (map to the real round, or park the others as Coming soon again).

export type Vault = {
  id: string;
  tag: "Daily" | "Weekly" | "Monthly";
  name: string;
  desc: string;
  price: number; // SOL per ticket
  image?: string; // /public path; vaults without one fall back to a lucide icon
  comingSoon: boolean;
  capacity: number;
  soldStart: number;
  potStart: number;
  endsInSec: number;
};

export const vaults: Vault[] = [
  {
    id: "sunrise",
    tag: "Daily",
    name: "Daily Vault",
    desc: "24h Daily draws with high frequency wins.",
    price: 0.5,
    image: "/chest-sunrise.png",
    comingSoon: false,
    capacity: 1200,
    soldStart: 842,
    potStart: 1284,
    endsInSec: 4 * 3600 + 21 * 60,
  },
  {
    id: "grand",
    tag: "Weekly",
    name: "Weekly Vault",
    desc: "Weekly draws with bigger price.",
    price: 1,
    image: "/purple_with_coin-removebg-preview.png",
    comingSoon: false,
    capacity: 5000,
    soldStart: 3418,
    potStart: 12438,
    endsInSec: 2 * 86400 + 11 * 3600,
  },
  {
    id: "diamond",
    tag: "Monthly",
    name: "Diamond Hoard",
    desc: "Monthly mega-jackpot draws.",
    price: 0.25,
    image: "/Chest_Wallpaper.png",
    comingSoon: true,
    capacity: 12000,
    soldStart: 9107,
    potStart: 48210,
    endsInSec: 14 * 86400 + 2 * 3600,
  },
];

export function formatCountdown(sec: number): string {
  if (sec <= 0) return "Draw closed";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Top ticker strip — ported from the maquette. Static mock data for now
// (TODO 10.17: feed from real on-chain events). Server Component.

type TickerItem = {
  name: string;
  action: string;
  value: string;
  tone: "buy" | "info" | "win";
};

const tickerItems: TickerItem[] = [
  { name: "7xKq…9fPa", action: "bought", value: "12 tickets", tone: "buy" },
  { name: "Round #248", action: "closes in", value: "04h 21m", tone: "info" },
  { name: "Bv2m…hLZ4", action: "won", value: "184 SOL", tone: "win" },
  { name: "3,418 tickets in this vault", action: "", value: "", tone: "info" },
  { name: "9qRn…pT1c", action: "bought", value: "3 tickets", tone: "buy" },
  { name: "Last draw paid", action: "in", value: "1.4s", tone: "info" },
  { name: "Ej4z…aM77", action: "won", value: "42 SOL", tone: "win" },
  { name: "Fk8w…vQ2s", action: "bought", value: "1 ticket", tone: "buy" },
];

export function Ticker() {
  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const items = [...tickerItems, ...tickerItems];
  return (
    <div className="w-full overflow-hidden border-b border-border bg-card/60 backdrop-blur">
      <div className="ticker-track flex gap-2 whitespace-nowrap py-2 text-xs">
        {items.map((it, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 ${
              it.tone === "win"
                ? // Literal greens (not tokens), so they need explicit dark: twins.
                  "bg-[oklch(0.96_0.06_165)] text-[oklch(0.35_0.15_160)] dark:bg-[oklch(0.35_0.08_165)] dark:text-[oklch(0.88_0.1_160)]"
                : it.tone === "info"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-card text-foreground"
            }`}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: "var(--gradient-brand)" }}
            />
            <span className="font-medium">{it.name}</span>
            {it.action && <span className="text-muted-foreground">{it.action}</span>}
            {it.value && <span className="font-semibold tabular-nums">{it.value}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

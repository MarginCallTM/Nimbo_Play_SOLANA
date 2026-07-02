// Site footer — ported from the reference maquette.
// Static markup -> Server Component. All links are placeholders ("#") until
// the matching pages exist.
// The legal paragraph was rewritten: the reference claimed "Switchboard VRF"
// and "audited smart contracts", neither of which is true for the MVP.

const socials = [
  {
    name: "telegram",
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
        <path d="M9.78 15.27 9.6 19a.6.6 0 0 0 1 .44l2.18-2.1 4.52 3.31c.83.46 1.42.22 1.63-.77l2.96-13.86c.27-1.23-.45-1.71-1.25-1.41L3.3 10.34c-1.2.48-1.19 1.16-.22 1.47l4.4 1.37 10.2-6.43c.48-.31.92-.14.56.17" />
      </svg>
    ),
  },
  {
    name: "x",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor">
        <path d="M18.244 2H21l-6.52 7.45L22 22h-6.84l-4.79-6.27L4.8 22H2l7-8L2 2h6.91l4.34 5.74L18.244 2Zm-1.2 18h1.86L7.04 4H5.1l11.944 16Z" />
      </svg>
    ),
  },
  {
    name: "discord",
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.074.035c-.211.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.65 12.65 0 0 0-.617-1.25.07.07 0 0 0-.073-.035A19.74 19.74 0 0 0 3.677 4.37a.06.06 0 0 0-.03.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .03.056 19.9 19.9 0 0 0 5.993 3.03.08.08 0 0 0 .084-.027 14.2 14.2 0 0 0 1.226-1.994.07.07 0 0 0-.04-.1 13.1 13.1 0 0 1-1.872-.892.07.07 0 0 1-.008-.117c.126-.094.252-.192.372-.291a.07.07 0 0 1 .074-.01c3.927 1.793 8.18 1.793 12.061 0a.07.07 0 0 1 .075.009c.12.1.246.198.373.292a.07.07 0 0 1-.006.117 12.3 12.3 0 0 1-1.873.891.07.07 0 0 0-.04.101 15.9 15.9 0 0 0 1.225 1.993.08.08 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.08.08 0 0 0 .03-.055c.5-5.177-.838-9.674-3.548-13.66a.06.06 0 0 0-.03-.028ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.42 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.335-.956 2.42-2.157 2.42Zm7.974 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.335-.946 2.42-2.157 2.42Z" />
      </svg>
    ),
  },
];

const linkColumns = [
  ["Audits", "Blog", "Docs", "Developers", "Ecosystem", "About"],
  ["Results", "Privacy", "Terms", "Responsible play"],
  ["Contact support"],
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background pb-10 pt-16">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 md:grid-cols-12">
        {/* Brand column */}
        <div className="md:col-span-5">
          <div className="flex items-center gap-2">
            <span
              className="grid size-8 place-items-center rounded-xl font-display text-sm text-primary-foreground"
              style={{ background: "var(--gradient-brand)" }}
            >
              S
            </span>
            <span className="font-display text-lg tracking-tight text-foreground">
              Solvault
            </span>
          </div>
          <p className="mt-5 font-display text-base text-foreground">
            Play the on-chain lottery on Solana.
          </p>

          <div className="mt-16 flex items-center gap-3">
            {socials.map((s) => (
              <a
                key={s.name}
                href="#"
                aria-label={s.name}
                className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/70 transition hover:bg-secondary/70 hover:text-foreground"
              >
                {s.icon}
              </a>
            ))}
          </div>

          <p className="mt-6 max-w-md text-xs leading-relaxed text-muted-foreground">
            Solvault is a decentralized lottery protocol on Solana, currently
            running on devnet as an educational project. Every draw settles
            on-chain and can be audited by anyone. Players must comply with
            the laws of their jurisdiction. Play responsibly.
          </p>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 gap-8 md:col-span-7 md:grid-cols-3">
          {linkColumns.map((column, i) => (
            <div key={i} className="space-y-4 text-sm">
              {column.map((l) => (
                <a
                  key={l}
                  href="#"
                  className="block font-medium text-foreground/80 hover:text-foreground"
                >
                  {l}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-7xl border-t border-border px-6 pt-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Solvault · Built on Solana
      </div>
    </footer>
  );
}

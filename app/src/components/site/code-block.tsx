// Animated code card for WhySolvault — adapted from a community snippet.
// Changes vs the original:
//  - recolored from cyan to our palette (primary #3981f6 family);
//  - the demo React counter was replaced by our REAL client call: the
//    section claims the lottery is auditable, so we show the actual
//    on-chain interaction instead of decorative code;
//  - `isolate` on the wrapper: the rotating border uses z-index:-10, and
//    without a local stacking context it would paint BEHIND the section's
//    white background (i.e. invisible);
//  - the border animation CSS lives in globals.css (project convention).
// Static markup -> Server Component. The Copy button is decorative for now
// (a real clipboard copy would require "use client").

export function CodeBlock() {
  return (
    <div className="relative isolate w-full max-w-2xl rounded-xl p-0.5">
      <div className="code-border-anim" />
      <div className="rounded-xl bg-[radial-gradient(at_88%_40%,#181925_0,transparent_85%),radial-gradient(at_49%_30%,#181925_0,transparent_85%),radial-gradient(at_14%_26%,#181925_0,transparent_85%),radial-gradient(at_0%_64%,#14337a_0,transparent_85%),radial-gradient(at_41%_94%,#3981f6_0,transparent_85%),radial-gradient(at_100%_99%,#101c3a_0,transparent_85%)] p-6 shadow-[0px_-16px_24px_0px_rgba(255,255,255,0.25)_inset]">
        <div className="flex items-center justify-between pb-4">
          <span className="text-base font-semibold text-white">
            buy_ticket.ts
          </span>
          <button className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/85">
            Copy
          </button>
        </div>
        <pre className="m-0 overflow-x-auto whitespace-pre rounded-lg bg-transparent p-0 text-sm leading-relaxed text-blue-100">
          <code>
            <span className="text-[#7aa8ff]">import</span>{" "}
            <span className="text-[#e0e0e0]">{"{"}</span> program{" "}
            <span className="text-[#e0e0e0]">{"}"}</span>{" "}
            <span className="text-[#7aa8ff]">from</span>{" "}
            <span className="text-[#f7b731]">&apos;@/lib/anchor&apos;</span>;
            <br />
            <br />
            <span className="italic text-[#7c8aa5]">
              {"// one ticket = one on-chain account"}
            </span>
            <br />
            <span className="text-[#7aa8ff]">const</span> signature ={" "}
            <span className="text-[#7aa8ff]">await</span> program.methods
            <br />
            &nbsp;&nbsp;.<span className="text-[#ffd60a]">buyTicket</span>()
            <br />
            &nbsp;&nbsp;.<span className="text-[#ffd60a]">accounts</span>(
            <span className="text-[#e0e0e0]">{"{"}</span> lottery, vault, buyer{" "}
            <span className="text-[#e0e0e0]">{"}"}</span>)
            <br />
            &nbsp;&nbsp;.<span className="text-[#ffd60a]">rpc</span>();
            <br />
            <br />
            <span className="italic text-[#7c8aa5]">
              {"// verify it yourself:"}
            </span>
            <br />
            <span className="text-[#36ffb1]">explorer.solana.com</span>/tx/
            <span className="text-[#e0e0e0]">{"${"}</span>signature
            <span className="text-[#e0e0e0]">{"}"}</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

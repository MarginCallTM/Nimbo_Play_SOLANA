// Animated code card for WhySolvault — adapted from a community snippet.
// Changes vs the original:
//  - recoloured from cyan to the F3 palette: indigo surface, coral glow. The
//    syntax colours stay blue-leaning on purpose — blue keywords are a code
//    convention readers already know, and recolouring them would cost
//    legibility for no gain;
//  - the demo React counter was replaced by our REAL client call: the
//    section claims the arena is auditable, so we show the actual on-chain
//    interaction instead of decorative code. Kept in sync with
//    programs/arena/src/lib.rs (`join`, JoinRound) — if the instruction or
//    its accounts change, THIS CARD MUST CHANGE TOO, otherwise the section
//    advertises a call that does not exist;
//  - `isolate` on the wrapper: the rotating border uses z-index:-10, and
//    without a local stacking context it would paint BEHIND the section's
//    white background (i.e. invisible);
//  - the border animation CSS lives in globals.css (project convention).
// Static markup -> Server Component. The Copy button is decorative for now
// (a real clipboard copy would require "use client").

export function CodeBlock() {
  return (
    // `min-w-0` is load-bearing, not cosmetic. As a flex item this box defaults
    // to min-width:auto, so it refuses to shrink below the intrinsic width of
    // the <pre> inside — the longest code line. The pre's own overflow-x-auto
    // then never engages, the box grows past the viewport and the whole PAGE
    // scrolls sideways. min-w-0 lets it shrink so the pre scrolls instead.
    <div className="relative isolate w-full min-w-0 max-w-2xl rounded-xl p-0.5">
      <div className="code-border-anim" />
      {/* Six stacked radial glows make the card surface. The three coloured
          ones used to be blues (#14337a / #3981f6 / #101c3a) left over from the
          old brand: bottom-left is now the deep cloud indigo, bottom-centre the
          coral accent (the light source, echoing the fire under the hero) and
          bottom-right a dark indigo. The three neutrals only lift the top. */}
      <div className="rounded-xl bg-[radial-gradient(at_88%_40%,#16122e_0,transparent_85%),radial-gradient(at_49%_30%,#16122e_0,transparent_85%),radial-gradient(at_14%_26%,#16122e_0,transparent_85%),radial-gradient(at_0%_64%,#282574_0,transparent_85%),radial-gradient(at_41%_94%,#ff7664_0,transparent_85%),radial-gradient(at_100%_99%,#241d4a_0,transparent_85%)] p-6 shadow-[0px_-16px_24px_0px_rgba(255,255,255,0.18)_inset]">
        <div className="flex items-center justify-between pb-4">
          <span className="text-base font-semibold text-white">
            join_round.ts
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
              {"// one entry = one stake locked in the round vault"}
            </span>
            <br />
            <span className="text-[#7aa8ff]">const</span> signature ={" "}
            <span className="text-[#7aa8ff]">await</span> program.methods
            <br />
            &nbsp;&nbsp;.<span className="text-[#ffd60a]">join</span>(
            <span className="text-[#7aa8ff]">new</span> BN(stake))
            <br />
            &nbsp;&nbsp;.<span className="text-[#ffd60a]">accounts</span>(
            <span className="text-[#e0e0e0]">{"{"}</span> player, round, vault,
            treasury, reserve <span className="text-[#e0e0e0]">{"}"}</span>)
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

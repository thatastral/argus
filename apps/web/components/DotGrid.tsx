/// Subtle animated dot-grid background, per Downloads/Animated Dots.md's brief. No per-dot DOM
/// nodes and no JS timers — a real per-dot-random implementation would need thousands of
/// elements or a canvas/JS animation loop, exactly what the brief's own performance section says
/// to avoid ("do not create hundreds of timers"). Instead: three copies of the same CSS
/// repeating-dot pattern, each opacity-animated at a different, deliberately non-shared duration
/// (7s / 9.5s / 6.2s — see app/globals.css). Their phases drift relative to each other
/// continuously, which reads as organic, non-synchronized twinkling in aggregate — the same
/// trick behind most lightweight "starfield" effects — without ever needing true per-dot state.
///
/// Meant to be mounted as the first child of a `relative overflow-hidden` container, with the
/// container's real content in a sibling wrapped in `relative z-10` so it stacks above this.
/// `intensity` is a further multiplier on top of the already-faint base values below (1 = the
/// dashboard card's level; pass something lower — e.g. 0.5 — for denser/more content-heavy
/// surfaces like the chat sidebar or onboarding, where legibility matters more).
const DOT_PATTERN = "radial-gradient(circle, rgba(138,138,138,0.12) 1px, transparent 1.6px)";
const DOT_SIZE = "24px 24px";

// Inline fractal-noise SVG, no external asset — a standard lightweight grain-texture technique.
const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const TWINKLE_LAYERS = ["animate-dot-twinkle-a", "animate-dot-twinkle-b", "animate-dot-twinkle-c"] as const;

export function DotGrid({ intensity = 1 }: { intensity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        opacity: intensity,
        // Fades the whole grid toward the edges rather than cutting off hard at the container
        // bounds — the brief's "blends naturally into the background" requirement. Uses `white`
        // (not `black`) for the "reveal" stop — `-webkit-mask-image` defaults to luminance-based
        // masking, where black means *hide* (opposite of alpha masking, where black at full
        // opacity means show); `white` reveals correctly under both modes, `black` only under
        // alpha mode. Using `black` here previously made the whole grid render far too faint —
        // or fully invisible, depending on which mask property the browser honored.
        maskImage: "radial-gradient(ellipse 75% 75% at 50% 40%, white 35%, transparent 85%)",
        WebkitMaskImage: "radial-gradient(ellipse 75% 75% at 50% 40%, white 35%, transparent 85%)",
      }}
    >
      {TWINKLE_LAYERS.map((animateClass) => (
        <div
          key={animateClass}
          className={`dot-twinkle-layer absolute inset-0 ${animateClass}`}
          style={{ backgroundImage: DOT_PATTERN, backgroundSize: DOT_SIZE }}
        />
      ))}
      <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: `url("${NOISE_DATA_URL}")` }} />
    </div>
  );
}

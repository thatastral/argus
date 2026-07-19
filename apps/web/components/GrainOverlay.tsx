/// Shared inline fractal-noise SVG data URI — a standard lightweight grain-texture technique, no
/// external asset. Previously duplicated inline inside `DotGrid.tsx`; now the single source of
/// truth, consumed two ways: `DotGrid.tsx` still layers its own local copy inside whichever
/// masked/animated dot panel it's mounted in (dashboard, onboarding, Modal, Landing), and this
/// component mounts a second, always-on, independent copy exactly once, globally, in
/// `app/layout.tsx` — so every screen gets the same subtle grain uniformly, including surfaces
/// that never mount `GlowBackground`/`DotGrid` at all (e.g. `AppHeader.tsx`'s thin chrome strip).
export const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

/// `fixed inset-0` (viewport-pinned, not scoped to any one container) with a negative z-index so
/// it paints behind ordinary in-flow page content (headers, cards, text) rather than on top of
/// it — a *positive* z-index on a positioned element paints after normal-flow content in the
/// same stacking context, which would sit the grain visibly over everything; negative does the
/// opposite. `Modal.tsx`'s backdrop (`z-50`) and `ChatSidebar.tsx` (`z-40`) still paint above
/// this regardless, since both are far higher explicit z-indices in the same root stacking
/// context. Deliberately very low opacity — this is meant to be felt, not seen.
export function GrainOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 opacity-[0.02]"
      style={{ backgroundImage: `url("${NOISE_DATA_URL}")` }}
    />
  );
}

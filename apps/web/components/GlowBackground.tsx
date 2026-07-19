/// Soft ambient glow, per Downloads/Background Glow.md's brief — reuses the exact palette from
/// the "Chat with Argus" hover glow (app/page.tsx's conic-gradient) rather than the brief's own
/// named colors, per direct instruction, so the two glow moments in the app read as the same
/// family of color. Rises from bottom-center, blurred and low-opacity, masked to fade upward —
/// no explicit fade-to-black color is painted; this sits on top of the real `bg-card` background
/// and simply fades its own opacity to 0, which reveals that background cleanly rather than
/// risking a visible seam against a hand-picked "near black" that might not exactly match
/// --card.
///
/// Meant to be mounted as a child of a `relative overflow-hidden` container, before the real
/// content (which needs `relative z-10` to stack above this). `intensity` further multiplies the
/// already-faint 20% base below (1 = the dashboard card's level; pass lower — e.g. 0.5 — for
/// denser surfaces like the chat sidebar or onboarding).
export function GlowBackground({ intensity = 1 }: { intensity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: intensity }}>
      <div
        className="absolute inset-x-0 bottom-0 h-[55%] opacity-25 blur-[60px]"
        style={{
          // No separate mask layer — the radial-gradients already fade to `transparent` at their
          // own outer stops (60-65%), which is enough edge-softening by itself. The extra
          // linear-gradient mask this had was a second, redundant fade mechanism and one more
          // thing that could silently fail; removed rather than debugged blind a third time.
          background: [
            "radial-gradient(60% 70% at 30% 100%, #ff6b9d 0%, transparent 60%)",
            "radial-gradient(55% 65% at 55% 100%, #ffd56b 0%, transparent 60%)",
            "radial-gradient(60% 70% at 75% 100%, #6bffb8 0%, transparent 60%)",
            "radial-gradient(65% 75% at 45% 100%, #6ba8ff 0%, transparent 65%)",
            "radial-gradient(70% 80% at 60% 100%, #b06bff 0%, transparent 65%)",
          ].join(", "),
        }}
      />
    </div>
  );
}

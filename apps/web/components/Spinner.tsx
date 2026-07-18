import { CircleNotch } from "@phosphor-icons/react";

/// The app's one loading-motion primitive — every busy state up to now was plain text
/// ("Saving…", "Confirm in wallet…") with no visual cue at all. Pair this with the existing text
/// rather than replacing it: the spinner adds the missing motion, the text still says what's
/// actually pending. `animate-spin` is a transform-only, GPU-cheap Tailwind built-in — no new
/// keyframe needed.
export function Spinner({ size = 14, className = "" }: { size?: 12 | 14 | 16 | 20; className?: string }) {
  return <CircleNotch size={size} weight="bold" className={`animate-spin ${className}`} />;
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/// Click-toggled so it works on touch (no reliable hover there) — layered with a
/// @media(hover:hover)-gated peek-on-hover for desktop (this app's other hover-reveal popovers
/// are hover-only with no touch fallback; this one is the first to support both). The two
/// reveal mechanisms are independent CSS states (`data-open` for click, `group-hover` gated
/// behind the hover-capable media query) rather than merged into one conditional class, so they
/// can't fight each other for which "wins."
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="group relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        className="inline-flex items-center"
      >
        {children}
      </button>
      <div
        role="tooltip"
        data-open={open}
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[14rem] -translate-x-1/2 rounded-lg bg-card px-2.5 py-1.5 text-center text-xs text-muted opacity-0 shadow-lg transition-opacity data-[open=true]:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
      >
        {label}
      </div>
    </div>
  );
}

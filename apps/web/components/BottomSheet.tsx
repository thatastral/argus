"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-opacity duration-200 ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`relative w-full max-w-lg rounded-t-2xl border border-b-0 border-border bg-background transition-transform duration-200 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between px-5 pt-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button onClick={onClose} className="text-xs text-muted underline">
            Close
          </button>
        </div>
        {/* Only mount children while open — otherwise their hooks (RPC polling, etc.) keep
            running in the background while hidden, and their inputs/buttons stay reachable
            by keyboard Tab order despite being invisible (opacity/pointer-events don't remove
            an element from the tab order). Unmounting doesn't affect the close transition,
            which is driven by the wrapper's translate-y, not by anything in here. */}
        <div className="max-h-[70vh] overflow-y-auto p-5">{open && children}</div>
      </div>
    </div>,
    document.body,
  );
}

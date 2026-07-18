"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";

/// Centered dialog — the one overlay pattern used for every non-inline destination (Habits,
/// Settings, Wallet, Streak). No border/outline on the panel per the design spec (Figma export
/// has none anywhere — cards, pills, and dialogs are distinguished by fill color only).
export function Modal({
  open,
  title,
  onClose,
  children,
  dismissible = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /// Set false for a modal the user must resolve (e.g. RecoverHabitsModal) — hides the Close
  /// icon, backdrop click, and Escape key, all of which would otherwise be dead ends.
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissible) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dismissible, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      {dismissible && <div className="absolute inset-0" onClick={onClose} />}
      <div className="animate-modal-in relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-card">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          {dismissible && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-muted transition-transform duration-150 ease-emil-out hover:text-foreground active:scale-[0.97]"
            >
              <X size={16} weight="bold" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

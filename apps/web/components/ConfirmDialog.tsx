"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open || typeof document === "undefined") return null;

  // Portalled to document.body rather than rendered in place: this dialog is opened from
  // inside BottomSheet's content, and BottomSheet's panel has an active CSS transform
  // (translate-y, for the slide animation) — a transformed ancestor becomes the containing
  // block for `position: fixed` descendants, which would make "fixed inset-0" cover the
  // sheet's panel instead of the viewport. Escaping via portal sidesteps that entirely.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-5">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="mt-2 text-sm text-muted">{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./Spinner";

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

  // Portalled to document.body rather than rendered in place: this can be opened from inside
  // any overlay (Modal, or previously a slide-up sheet), and an ancestor with an active CSS
  // transform becomes the containing block for `position: fixed` descendants — which would
  // make "fixed inset-0" cover just that ancestor instead of the viewport. Escaping via portal
  // sidesteps this regardless of which overlay it's opened from.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="animate-modal-in w-full max-w-sm rounded-2xl bg-card p-5">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="mt-2 text-sm text-muted">{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-md bg-surface px-3 py-1.5 text-sm transition-transform duration-150 ease-emil-out hover:opacity-80 active:scale-[0.97] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
          >
            {pending && <Spinner size={14} />}
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

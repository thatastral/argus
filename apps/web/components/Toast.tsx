"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";

type ToastVariant = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastContext = createContext<((message: string, variant?: ToastVariant) => void) | null>(null);

const TOAST_DURATION_MS = 3500;

/// Success-acknowledgment only, not a replacement for the app's existing inline error text
/// (text-xs text-red-500, used throughout) — errors stay put next to the control that caused
/// them since they're safety-relevant and shouldn't auto-vanish. Toasts fill the gap that
/// actually existed: a successful action (habit created, deposit confirmed, settings saved)
/// previously had no acknowledgment beyond the UI quietly updating around it.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
            {toasts.map((t) => {
              const Icon = t.variant === "error" ? WarningCircle : CheckCircle;
              return (
                <div
                  key={t.id}
                  className="animate-toast-in pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm shadow-lg"
                >
                  <Icon
                    size={16}
                    weight="fill"
                    className={`shrink-0 ${t.variant === "error" ? "text-warning" : "text-success"}`}
                  />
                  <span className="flex-1">{t.message}</span>
                  <button
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss"
                    className="shrink-0 text-muted hover:text-foreground"
                  >
                    <X size={14} weight="bold" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within a ToastProvider");
  return toast;
}

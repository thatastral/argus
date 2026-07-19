"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, CaretDoubleRight } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import { useCreateHabit } from "@/hooks/useCreateHabit";
import { useRenameHabit } from "@/hooks/useRenameHabit";
import { useDeleteHabit } from "@/hooks/useDeleteHabit";
import { useVaultTransfer } from "@/hooks/useVaultTransfer";
import { useSetPenaltyType } from "@/hooks/useSetPenaltyType";
import { PENALTY_TYPE_LABEL, type PenaltyType } from "@/lib/penalty";
import { WalletReconnect } from "./WalletReconnect";
import { Spinner } from "./Spinner";
import { useToast } from "./Toast";
import { GlowBackground } from "./GlowBackground";
import { DotGrid } from "./DotGrid";

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

// Minimal overrides so markdown renders as plain flowing text (no default browser margins/list
// indents) rather than fitting a bubble — assistant replies aren't bubbled anymore, see the
// message-list rendering below.
const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <p className="[&:not(:first-child)]:mt-2">{children}</p>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
};

// Fixed 530px at `sm:` and up (unchanged desktop behavior); full-bleed below it, since a
// hardcoded 530px panel would overflow/be unusable on any phone-width viewport. Still used by
// app/page.tsx for its matching `sm:pr-[530px]` content-push at the same breakpoint.
export const CHAT_SIDEBAR_WIDTH = 530;

// Shown only in the empty-conversation state, to remove the blank-input cold start — each just
// populates and immediately sends, same as typing it and hitting Enter.
const QUICK_ACTIONS = ["How's my streak?", "What's my balance?", "Add a habit"];

type ProposedAction =
  | { type: "create_habit"; name: string; stakeAmount: string; assetSymbol: string; assetDecimals: number }
  | { type: "edit_habit"; contractIndex: number; currentName: string; newName: string }
  | { type: "deactivate_habit"; contractIndex: number; name: string }
  | { type: "deposit"; amount: string }
  | { type: "set_penalty_type"; penaltyType: PenaltyType }
  | { type: "withdraw"; amount: string };

function actionLabel(action: ProposedAction): string {
  switch (action.type) {
    case "create_habit":
      return `Create "${action.name}" — stake ${action.stakeAmount} ${action.assetSymbol}`;
    case "edit_habit":
      return `Rename "${action.currentName}" to "${action.newName}"`;
    case "deactivate_habit":
      return `Deactivate "${action.name}"`;
    case "deposit":
      return `Deposit ${action.amount}`;
    case "set_penalty_type":
      return `Set consequence to ${PENALTY_TYPE_LABEL[action.penaltyType]}`;
    case "withdraw":
      return `Withdraw ${action.amount}`;
  }
}

interface Message {
  role: "user" | "assistant";
  content: string;
  // A single reply can propose more than one action (e.g. "deposit 1 and commit 0.5") — each
  // gets its own confirm/dismiss control below, resolved independently via `actionResolutions`
  // (parallel array, same index as `proposedActions`).
  proposedActions?: ProposedAction[];
  actionResolutions?: ("confirmed" | "dismissed" | undefined)[];
}

function withResolution<T>(arr: T[] | undefined, index: number, value: T): T[] {
  const next = arr ? [...arr] : [];
  next[index] = value;
  return next;
}

/// Fixed, full-height right dock — the standard AI-chat-sidebar pattern (Notion AI, Cursor,
/// Intercom): pinned to the viewport, CHAT_SIDEBAR_WIDTH wide at `sm:` and up, full-bleed below
/// it. Page content reserves the same width via padding in app/page.tsx (only at `sm:`+, since
/// below it this panel is already full-width) so nothing — including the nav bar's pills — ever
/// sits underneath it. Kept always-mounted (unlike Modal's portal children) so the conversation
/// survives collapsing the panel.
export function ChatSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { createHabit, busy: creatingHabit, isConnected } = useCreateHabit();
  const { renameHabit, busy: renamingHabit } = useRenameHabit();
  const { deleteHabit, busy: deactivatingHabit } = useDeleteHabit();
  const { deposit, withdraw, busy: transferring } = useVaultTransfer();
  const { setPenaltyType, busy: settingPenaltyType } = useSetPenaltyType();
  const toast = useToast();
  const actionBusy = creatingHabit || renamingHabit || deactivatingHabit || transferring || settingPenaltyType;

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, sending]);

  // On-screen keyboard inset (mobile) — the panel is `fixed inset-y-0`, which measures the
  // *layout* viewport; iOS Safari (and some Android browsers) don't shrink that when the
  // keyboard opens, they just overlay it, so the composer (the last flex child, pinned to the
  // bottom of this panel) could end up rendered behind the keyboard with no way to see what's
  // being typed. window.visualViewport tracks the actually-visible area directly — its height
  // shrinks (and offsetTop can shift) exactly when the keyboard opens, giving a live inset to
  // push the composer up by by padding the bottom of the flex column instead.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function handleViewportChange() {
      if (!vv) return;
      setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    }
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    handleViewportChange();
    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  // Loads once on mount (this component stays mounted regardless of open/closed — see the doc
  // comment above) — hydrates prior turns so reopening/reloading doesn't lose the conversation
  // the way it used to (chat_messages was written on every turn but never read back).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages?: { role: "user" | "assistant"; content: string }[] } | null) => {
        if (!cancelled && data?.messages?.length) {
          setMessages(data.messages.map((m) => ({ role: m.role, content: m.content })));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(overrideText?: string) {
    const userMessage = overrideText ?? input.trim();
    if (!userMessage || sending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });
      const data = await res.json().catch(() => null);
      const content = res.ok && data?.reply ? data.reply : (data?.error ?? "Something went wrong. Try again.");
      setMessages((prev) => [...prev, { role: "assistant", content, proposedActions: data?.proposedActions }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setSending(false);
    }
  }

  // messageIndex/actionIndex — a message can carry several proposed actions (a compound request
  // like "deposit 1 and commit 0.5"), each confirmed/dismissed independently; actionIndex picks
  // which one within that message's proposedActions/actionResolutions arrays.
  async function resolveAction(messageIndex: number, actionIndex: number, confirm: boolean) {
    const action = messages[messageIndex]?.proposedActions?.[actionIndex];
    if (!action) return;

    if (!confirm) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === messageIndex ? { ...m, actionResolutions: withResolution(m.actionResolutions, actionIndex, "dismissed") } : m,
        ),
      );
      return;
    }

    let ok = false;
    let doneText = "";
    switch (action.type) {
      case "create_habit":
        ok = await createHabit(action.name, action.stakeAmount, action.assetDecimals, action.assetSymbol);
        doneText = `"${action.name}" was created.`;
        break;
      case "edit_habit":
        ok = await renameHabit(action.contractIndex, action.newName);
        doneText = `"${action.currentName}" was renamed to "${action.newName}".`;
        break;
      case "deactivate_habit":
        ok = await deleteHabit(action.contractIndex);
        doneText = `"${action.name}" was deactivated.`;
        break;
      case "deposit":
        ok = await deposit(action.amount);
        doneText = `Deposited ${action.amount}.`;
        break;
      case "set_penalty_type":
        ok = await setPenaltyType(action.penaltyType);
        doneText = `Consequence set to ${PENALTY_TYPE_LABEL[action.penaltyType]}.`;
        break;
      case "withdraw":
        ok = await withdraw(action.amount);
        doneText = `Withdrew ${action.amount}.`;
        break;
    }

    setMessages((prev) =>
      prev.map((m, i) =>
        i === messageIndex
          ? { ...m, actionResolutions: withResolution(m.actionResolutions, actionIndex, ok ? "confirmed" : undefined) }
          : m,
      ),
    );
    if (ok) {
      toast(doneText);
      setMessages((prev) => [...prev, { role: "assistant", content: `Done — ${doneText}` }]);
    }
  }

  return (
    <aside
      aria-hidden={!open}
      className={`fixed inset-y-0 inset-x-0 z-40 flex w-full flex-col overflow-hidden bg-card transition-transform duration-300 ease-emil-out sm:inset-x-auto sm:right-0 sm:w-[530px] ${
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      {/* Visually confirmed working — the earlier diagnostic (a solid red probe div, plus glow/
          dot intensity pushed to 1.4 to force visibility while investigating a masking bug
          elsewhere) is no longer needed. Intensity brought in line with the rest of the app's
          denser surfaces (Modal.tsx's 0.4 glow / 0.15 dots) instead of the dashboard card's 1
          baseline, since this panel is similarly content-dense. */}
      <GlowBackground intensity={0.4} />
      <DotGrid intensity={0.15} />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold">Chat with Argus</span>
        <button
          onClick={onClose}
          aria-label="Collapse chat"
          className={`flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted hover:text-foreground ${PRESS_FEEDBACK}`}
        >
          <CaretDoubleRight size={16} weight="bold" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
        {messages.length === 0 && <p className="pt-2 text-sm text-muted">Ask about your streak, wallet, progress, or add a habit.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${m.role === "user" ? "" : "w-full"}`}>
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap break-words rounded-3xl bg-foreground px-4 py-2.5 text-sm text-background">
                  {m.content}
                </p>
              ) : (
                // Plain flowing text, no bubble — the current pattern in ChatGPT/Claude's own
                // interfaces: a bubble reads fine for a short user message, but wraps an
                // assistant's longer, often-multi-paragraph reply in an oddly-shaped box instead
                // of just reading as text on the page.
                <div className="text-sm leading-relaxed text-foreground">
                  <ReactMarkdown components={MARKDOWN_COMPONENTS}>{m.content}</ReactMarkdown>
                </div>
              )}

              {m.proposedActions && m.proposedActions.length > 0 && (
                <div className="mt-2.5 flex flex-col items-start gap-1.5">
                  {m.proposedActions.map((action, j) => {
                    const resolution = m.actionResolutions?.[j];
                    if (resolution === "confirmed") return null;
                    if (resolution === "dismissed") {
                      return (
                        <div
                          key={j}
                          className="flex w-full items-center gap-2 rounded-xl bg-surface/50 px-3 py-2 text-xs text-muted"
                        >
                          <span className="truncate line-through decoration-white/25">{actionLabel(action)}</span>
                          <span className="shrink-0">Dismissed</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={j}
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5"
                      >
                        <span className="text-xs font-medium">{actionLabel(action)}</span>
                        {isConnected ? (
                          <div className="flex shrink-0 gap-2">
                            <button
                              onClick={() => resolveAction(i, j, true)}
                              disabled={actionBusy}
                              className={`flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
                            >
                              {actionBusy && <Spinner size={12} />}
                              {actionBusy ? "Confirming…" : "Confirm"}
                            </button>
                            <button
                              onClick={() => resolveAction(i, j, false)}
                              disabled={actionBusy}
                              className={`rounded-full bg-white/10 px-3 py-1.5 text-xs ${PRESS_FEEDBACK} disabled:opacity-50`}
                            >
                              Dismiss
                            </button>
                          </div>
                        ) : (
                          <div className="w-full">
                            <WalletReconnect />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <span className="inline-flex items-center gap-1 py-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Floating, ChatGPT-style composer — a rounded pill that sits above the background rather
          than a flat bar with a rule above it (the old border-t border-border divider is
          deliberately gone here; the pill's own fill against bg-card is the separation now).
          paddingBottom tracks the on-screen keyboard (see the visualViewport effect above) so
          typing on mobile never happens behind the keyboard, out of view. */}
      <div className="px-4 pb-4 pt-1" style={{ paddingBottom: keyboardInset > 0 ? keyboardInset + 16 : undefined }}>
        {/* Quick-start pills moved to sit directly above the input (were previously at the top
            of the empty-conversation state) — only shown before the first message, same as
            before, just repositioned per a direct instruction. */}
        {messages.length === 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className={`rounded-full bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground ${PRESS_FEEDBACK}`}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-3xl bg-surface px-4 py-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message Argus…"
            className="flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted"
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background ${PRESS_FEEDBACK} disabled:opacity-40`}
          >
            <ArrowUp size={16} weight="bold" />
          </button>
        </div>
      </div>
      </div>
    </aside>
  );
}

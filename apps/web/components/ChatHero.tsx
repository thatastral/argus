"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/// The primary interface, per the PRD: a big centered input rather than a side panel.
/// Conversation renders above the input once it starts, ChatGPT-landing style.
export function ChatHero() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? "Something went wrong." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="w-full">
      {messages.length > 0 && (
        <div className="mb-4 max-h-80 space-y-3 overflow-y-auto px-1">
          {messages.map((m, i) => (
            <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : "text-left"}`}>
              <span
                className={`inline-block max-w-[85%] rounded-2xl px-4 py-2 ${
                  m.role === "user" ? "bg-foreground text-background" : "bg-surface text-foreground"
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 pl-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about your streak, wallet, or progress…"
          className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
        >
          {sending ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}

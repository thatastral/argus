import { Sparkle } from "@phosphor-icons/react";

/// One of two spots that use the --flame accent (the other is AppHeader.tsx's streak badge) —
/// deliberately reserved for just these two gamification/AI-flavored moments, see globals.css.
export function InsightCard({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-flame/15 text-flame">
        <Sparkle size={16} weight="fill" />
      </span>
      <div>
        <p className="text-xs font-medium text-white/70">Argus&apos; Insight</p>
        <p className="mt-0.5 text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

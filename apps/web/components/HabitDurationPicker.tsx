"use client";

import { useState } from "react";
import { DURATION_PRESETS } from "@/lib/habitDuration";

function formatEndDate(days: number): string {
  const end = new Date();
  end.setDate(end.getDate() + days);
  return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function tomorrowIso(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

/// Shared by AddHabitModal.tsx and SetupFlow.tsx's habit-creation step — presets cover the
/// common cases (matches how most habit apps frame commitment: relative duration, not a raw
/// date), "Pick a date" covers wanting a precise, specific deadline. Either path always shows
/// the actual resulting date below, since a bare "1 month" label doesn't say when that actually
/// is — still stored as target_days under the hood (habits.target_days, see migration 0002), a
/// custom date just gets converted to a day count at selection time.
export function HabitDurationPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (days: number | null) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const isPreset = DURATION_PRESETS.some((p) => p.days === value);

  function selectCustomDate(dateStr: string) {
    if (!dateStr) return;
    const selected = new Date(`${dateStr}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.ceil((selected.getTime() - today.getTime()) / 86_400_000));
    onChange(days);
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-white/70">How consistent do you want to be?</label>
      <div className="grid grid-cols-2 gap-2">
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              setCustomOpen(false);
              onChange(preset.days);
            }}
            className={`rounded-md px-3 py-2 text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] ${
              !customOpen && isPreset && value === preset.days ? "bg-foreground text-background" : "bg-surface"
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => setCustomOpen(true)}
          className={`col-span-2 rounded-md px-3 py-2 text-sm transition-transform duration-150 ease-emil-out active:scale-[0.97] ${
            customOpen || (!isPreset && value !== null) ? "bg-foreground text-background" : "bg-surface"
          }`}
        >
          Pick a date
        </button>
      </div>

      {(customOpen || (!isPreset && value !== null)) && (
        <input
          type="date"
          min={tomorrowIso()}
          onChange={(e) => selectCustomDate(e.target.value)}
          className="w-full rounded-md bg-surface px-3 py-2 text-sm transition-colors duration-150 ease-emil-out [color-scheme:dark] focus:bg-white/[0.08] focus:outline-none"
        />
      )}

      <p className="text-xs text-muted">
        {value === null
          ? "No end date — keep going indefinitely."
          : `Ends ${formatEndDate(value)} (${value} day${value === 1 ? "" : "s"} from today).`}
      </p>
    </div>
  );
}

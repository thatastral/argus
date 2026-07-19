"use client";

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/// Recurring daily deadline for this specific habit — separate from HabitDurationPicker's
/// commitment length (how many days total) and from HabitManager's fixed UTC-midnight day
/// boundary (which this never changes — purely a display/reminder concept, see migration
/// 0004). Native <input type="time"> rather than a hand-rolled scroll-wheel picker — matches
/// the same "native, industry-standard input" choice already made for the custom-date field in
/// HabitDurationPicker, without the much bigger build for a custom wheel component.
export function HabitDeadlineTimePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (time: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-white/70">Daily deadline (optional)</label>
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="flex-1 rounded-md bg-surface px-3 py-2 text-sm transition-colors duration-150 ease-emil-out [color-scheme:dark] focus:bg-white/[0.08] focus:outline-none"
        />
        {value !== null && (
          <button
            onClick={() => onChange(null)}
            className="rounded-md bg-surface px-3 py-2 text-xs text-muted transition-transform duration-150 ease-emil-out active:scale-[0.97]"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {value ? `Complete this habit by ${formatTime12h(value)} each day.` : "No set time — any time during the day works."}
      </p>
    </div>
  );
}

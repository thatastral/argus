"use client";

import { useRef, useState } from "react";

interface Habit {
  contract_index: number;
  name: string;
  active: boolean;
}

interface VerifyResult {
  verified: boolean;
  confidence: number;
  reason: string;
}

const MAX_PROOF_FILE_BYTES = 8 * 1024 * 1024; // 8MB — base64 inflates ~33%, keep well under typical body limits

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function HabitRow({
  habit,
  completed,
  onVerified,
}: {
  habit: Habit;
  completed: boolean;
  onVerified: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.size > MAX_PROOF_FILE_BYTES) {
      setError("That image is too large — try one under 8MB.");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIndex: habit.contract_index, imageBase64: base64, mimeType }),
      });
      if (!res.ok) throw new Error("Verification request failed");
      const data: VerifyResult = await res.json();
      setResult(data);
      if (data.verified) onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{habit.name}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            completed ? "bg-surface text-foreground" : "border border-border text-muted"
          }`}
        >
          {completed ? "Done today" : "Not done yet"}
        </span>
      </div>

      {!completed && (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {uploading ? "Verifying…" : "Upload proof"}
          </button>
        </div>
      )}

      {result && (
        <p className={`mt-2 text-xs ${result.verified ? "text-foreground" : "text-red-500"}`}>
          {result.verified ? "✓" : "✗"} {result.reason} ({Math.round(result.confidence * 100)}% confidence)
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function HabitList({
  habits,
  completedIndexes,
  onVerified,
}: {
  habits: Habit[];
  completedIndexes: number[];
  onVerified: () => void;
}) {
  if (habits.length === 0) {
    return <p className="text-sm text-muted">No habits yet.</p>;
  }

  return (
    <div className="space-y-3">
      {habits
        .filter((h) => h.active)
        .map((habit) => (
          <HabitRow
            key={habit.contract_index}
            habit={habit}
            completed={completedIndexes.includes(habit.contract_index)}
            onVerified={onVerified}
          />
        ))}
    </div>
  );
}

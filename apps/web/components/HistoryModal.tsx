"use client";

import { useEffect, useState } from "react";
import { DayGroupsList, type HistoryResponse } from "./HabitDayGroups";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";

/// Full-range companion to HabitList.tsx's home view (which is capped at
/// HOME_WINDOW_DAYS=4) — fetches the same route with `?window=full`, going back to the
/// wallet's on-chain startDay instead. No `open` prop on the inner content: like
/// LiveCameraCapture.tsx, Modal.tsx only renders its children while `open` is true, so this
/// mounts fresh (and re-fetches) every time the modal is opened rather than needing its own
/// reset-in-effect.
function HistoryContent({ onVerified }: { onVerified: () => void }) {
  const [data, setData] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/habits/history?window=full")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setData(json);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <Spinner size={14} /> Loading…
      </p>
    );
  }

  return <DayGroupsList days={data.days} penaltyType={data.penaltyType} onVerified={onVerified} />;
}

export function HistoryModal({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}) {
  return (
    <Modal open={open} title="Full history" onClose={onClose}>
      <HistoryContent onVerified={onVerified} />
    </Modal>
  );
}

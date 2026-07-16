"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccountabilityWallet } from "@/hooks/useAccountabilityWallet";
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
  const { symbol, assetDecimals, walletAddress } = useAccountabilityWallet();

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

  const stakeLabel =
    data?.stakeAmountWei != null
      ? `${formatUnits(BigInt(data.stakeAmountWei), walletAddress ? assetDecimals : 18)} ${walletAddress ? symbol : "MON"}`
      : null;

  if (!data) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <Spinner size={14} /> Loading…
      </p>
    );
  }

  return <DayGroupsList days={data.days} stakeLabel={stakeLabel} onVerified={onVerified} />;
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

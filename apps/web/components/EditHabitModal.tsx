"use client";

import { useState } from "react";
import { useRenameHabit } from "@/hooks/useRenameHabit";
import { useDeleteHabit } from "@/hooks/useDeleteHabit";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./Spinner";
import { useToast } from "./Toast";

/// Caller must render this keyed by contractIndex (see HabitList.tsx) — that's what resets
/// `name` back to currentName when a different habit is opened, without an effect+setState.
export function EditHabitModal({
  open,
  onClose,
  contractIndex,
  currentName,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  contractIndex: number | null;
  currentName: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { renameHabit, busy: renaming, error: renameError } = useRenameHabit();
  const { deleteHabit, busy: deleting, error: deleteError, cancel: cancelDelete } = useDeleteHabit();
  const toast = useToast();

  if (contractIndex === null) return null;

  async function save() {
    const ok = await renameHabit(contractIndex!, name.trim());
    if (ok) {
      toast(`Renamed to "${name.trim()}"`);
      onSaved();
      onClose();
    }
  }

  async function confirmDelete() {
    const ok = await deleteHabit(contractIndex!);
    setConfirmingDelete(false);
    if (ok) {
      toast(`"${currentName}" was deleted`);
      onDeleted();
      onClose();
    }
  }

  return (
    <Modal open={open} title="Edit habit" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-white/70">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md bg-surface px-3 py-2 text-sm"
          />
          {renameError && <p className="text-xs text-red-500">{renameError}</p>}
          <button
            onClick={save}
            disabled={renaming || !name.trim() || name.trim() === currentName}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
          >
            {renaming && <Spinner size={14} />}
            {renaming ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={deleting}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-surface px-3 py-2 text-sm text-warning transition-transform duration-150 ease-emil-out active:scale-[0.97] disabled:opacity-50"
          >
            {deleting && <Spinner size={14} />}
            {deleting ? "Removing…" : "Delete habit"}
          </button>
          {deleteError && (
            <p className="text-xs text-red-500">
              {deleteError} <button onClick={cancelDelete} className="underline">Cancel stuck request</button>
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete habit"
        description={`Remove "${currentName}"? This can't be undone — habit slots can't be reused once created.`}
        confirmLabel="Delete"
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { useConnect } from "wagmi";
import { CaretRight, Wallet } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

/// Argus's server session (httpOnly cookie, 7-day TTL) can outlive the actual wagmi/wallet
/// connection — e.g. after a browser restart the extension drops its site connection while
/// the session cookie is still valid. Any step that needs to write on-chain must check
/// isConnected itself rather than assuming "has a session" implies "wallet is live", or
/// writeContractAsync throws ConnectorNotConnectedError with no recovery path in the UI.
/// Render this in place of the normal action UI whenever `!isConnected`.
///
/// A single "Reconnect Wallet" button opening a connector-picker popup, not every installed
/// connector dumped inline as its own button — the same fix ConnectButton.tsx already got (fine
/// with one extension installed, cluttered/alarming with several). No sign-in step here unlike
/// ConnectButton — the session cookie is still valid, only the live wagmi connection dropped, so
/// picking a connector is the only thing needed; this component unmounts itself once the caller's
/// own `isConnected` check flips true, closing the modal along with it.
export function WalletReconnect() {
  const { connect, connectors, isPending } = useConnect();
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-2 rounded-md bg-surface p-3">
      <p className="text-xs text-muted">Your wallet disconnected — reconnect to continue.</p>
      <button
        onClick={() => setModalOpen(true)}
        className={`flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm text-background ${PRESS_FEEDBACK}`}
      >
        <Wallet size={16} weight="fill" />
        Reconnect Wallet
      </button>

      <Modal open={modalOpen} title="Reconnect a Wallet" onClose={() => setModalOpen(false)}>
        {connectors.length === 0 ? (
          <p className="text-sm text-muted">No wallet found. Install MetaMask or Rabby.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {connectors.map((connector) => {
              const connectingThis = isPending && pendingConnectorUid === connector.uid;
              return (
                <button
                  key={connector.uid}
                  onClick={() => {
                    setPendingConnectorUid(connector.uid);
                    connect({ connector });
                  }}
                  disabled={isPending}
                  className={`flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left ${PRESS_FEEDBACK} disabled:opacity-50`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5">
                    {connector.icon ? (
                      // Real per-wallet brand logo via EIP-6963, same as ConnectButton.tsx —
                      // falls back to the generic Wallet glyph only if none was announced.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={connector.icon} alt="" className="h-6 w-6 rounded-full" />
                    ) : (
                      <Wallet size={18} weight="fill" className="text-muted" />
                    )}
                  </span>
                  <span className="flex-1 text-sm font-medium">{connector.name}</span>
                  {connectingThis ? (
                    <Spinner size={16} />
                  ) : (
                    <CaretRight size={16} weight="bold" className="text-muted" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}

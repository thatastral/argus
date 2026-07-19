"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { CaretRight, SignIn, Wallet } from "@phosphor-icons/react";
import { activeChain } from "@/lib/wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { friendlyErrorMessage } from "@/lib/formatError";

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

/// The landing screen used to dump every installed wallet connector straight onto the page as a
/// stack of buttons — fine with one extension installed, cluttered and a little alarming with
/// several (Phantom + MetaMask + Rabby all at once). This now shows a single "Connect Wallet"
/// entry point; the connector list (and the connected-but-not-signed-in step right after it)
/// lives inside a popup instead, using the app's one Modal.tsx pattern rather than a bespoke
/// overlay.
export function ConnectButton({ onSignedIn }: { onSignedIn: (wallet: string) => void }) {
  const { address, isConnected, chainId, connector: activeConnector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  // wagmi's own `variables.connector` on the mutation result is typed as `CreateConnectorFn |
  // Connector` (only the latter has `.uid`), so tracking which row is spinning is simpler done
  // locally than narrowing that union on every render.
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string | null>(null);
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown only right after an in-app disconnect, to set the right expectation for wallets that
  // silently reconnect to the same address (see the comment near the hint text below).
  const [justDisconnected, setJustDisconnected] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const onWrongChain = isConnected && chainId !== activeChain.id;

  function disconnectAndReset() {
    setError(null);
    setJustDisconnected(true);
    disconnect();
  }

  function closeModal() {
    setModalOpen(false);
    setError(null);
  }

  async function signIn() {
    if (!address) return;
    setError(null);
    setIsSigningIn(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!nonceRes.ok) throw new Error("Could not start sign-in");
      const { nonce, message } = await nonceRes.json();

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, nonce, signature }),
      });
      if (!verifyRes.ok) throw new Error("Signature verification failed");

      onSignedIn(address);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Sign-in failed"));
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={`flex items-center gap-2.5 rounded-full bg-foreground px-8 py-4 text-base font-medium text-background ${PRESS_FEEDBACK}`}
      >
        <Wallet size={20} weight="fill" />
        Connect Wallet
      </button>

      {/* `open` also follows `isConnected` directly (not just `modalOpen`) so a page reload that
          lands here with the wallet already connected but not yet signed in (session cookie
          missing/expired) reopens straight to the sign-in step, instead of a bare "Connect
          Wallet" button with no obvious next move. `dismissible` is false for that same step —
          the only useful actions once connected are Sign In or Disconnect, so closing the popup
          without picking one would just reopen it. */}
      <Modal
        open={modalOpen || isConnected}
        dismissible={!isConnected}
        title={isConnected ? "Sign In" : "Connect a Wallet"}
        onClose={closeModal}
      >
        {!isConnected ? (
          connectors.length === 0 ? (
            <p className="text-sm text-muted">No wallet found. Install MetaMask or Rabby.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {connectors.map((connector) => {
                const connectingThis = isConnecting && pendingConnectorUid === connector.uid;
                return (
                  <button
                    key={connector.uid}
                    onClick={() => {
                      setJustDisconnected(false);
                      setPendingConnectorUid(connector.uid);
                      connect({ connector });
                    }}
                    disabled={isConnecting}
                    className={`flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left ${PRESS_FEEDBACK} disabled:opacity-50`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5">
                      {connector.icon ? (
                        // Real per-wallet brand logo, not a hardcoded asset — EIP-6963 announced
                        // providers (how `injected()` discovers each installed extension) each
                        // report their own `icon` as a data URI, so MetaMask/Rabby/Phantom/etc.
                        // show their actual mark here with zero brand-icon bundling. Falls back
                        // to the generic Wallet glyph only for a connector that never announced
                        // one (e.g. a lone `window.ethereum` with no EIP-6963 support).
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
              {justDisconnected && (
                // Some wallet extensions silently reconnect to the same address once the origin
                // already has a grant — the app already requests wallet_requestPermissions to
                // force a fresh account picker, but that only works for wallets that implement
                // EIP-2255.
                <p className="px-1 pt-1 text-center text-xs text-muted">
                  Still see the same address? Revoke site access in your wallet settings.
                </p>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-surface">
              {activeConnector?.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeConnector.icon} alt="" className="h-8 w-8 rounded-full" />
              ) : (
                <SignIn size={22} weight="fill" className="text-muted" />
              )}
            </span>
            <p className="font-mono text-xs text-muted">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </p>

            {onWrongChain ? (
              <div className="flex w-full flex-col items-center gap-2">
                <p className="text-xs text-muted">
                  Wrong network — Argus runs on {activeChain.name}.
                </p>
                <button
                  onClick={() =>
                    switchChainAsync({ chainId: activeChain.id }).catch((err) =>
                      setError(friendlyErrorMessage(err, "Failed to switch network")),
                    )
                  }
                  disabled={isSwitchingChain}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-3 text-sm text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
                >
                  {isSwitchingChain && <Spinner size={14} />}
                  {isSwitchingChain ? "Switching…" : `Switch to ${activeChain.name}`}
                </button>
              </div>
            ) : (
              <div className="flex w-full flex-col gap-2">
                <button
                  onClick={signIn}
                  disabled={isSigningIn}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-3 text-sm text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
                >
                  {isSigningIn && <Spinner size={14} />}
                  {isSigningIn ? "Signing in…" : "Sign in with Wallet"}
                </button>
                <button
                  onClick={disconnectAndReset}
                  className={`w-full rounded-full bg-surface px-4 py-3 text-sm ${PRESS_FEEDBACK}`}
                >
                  Disconnect
                </button>
              </div>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}

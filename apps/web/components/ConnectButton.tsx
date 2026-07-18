"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/wagmi";
import { Spinner } from "./Spinner";

const PRESS_FEEDBACK = "transition-transform duration-150 ease-emil-out active:scale-[0.97]";

export function ConnectButton({ onSignedIn }: { onSignedIn: (wallet: string) => void }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown only right after an in-app disconnect, to set the right expectation for wallets that
  // silently reconnect to the same address (see the comment near the hint text below).
  const [justDisconnected, setJustDisconnected] = useState(false);

  const onWrongChain = isConnected && chainId !== activeChain.id;

  function disconnectAndReset() {
    setError(null);
    setJustDisconnected(true);
    disconnect();
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
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setIsSigningIn(false);
    }
  }

  if (!isConnected) {
    if (connectors.length === 0) {
      return <p className="text-xs text-muted">No wallet found — install MetaMask or Rabby.</p>;
    }
    return (
      <div className="flex flex-col items-center gap-2">
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => {
              setJustDisconnected(false);
              connect({ connector });
            }}
            disabled={isConnecting}
            className={`flex w-48 items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
          >
            {isConnecting && <Spinner size={14} />}
            {isConnecting ? "Connecting…" : `Connect ${connector.name}`}
          </button>
        ))}
        {justDisconnected && (
          // Some wallet extensions silently reconnect to the same address once the origin
          // already has a grant — the app already requests wallet_requestPermissions to force
          // a fresh account picker, but that only works for wallets that implement EIP-2255.
          <p className="max-w-48 text-center text-xs text-muted">
            Still seeing the same address? Revoke this site&apos;s access in your wallet&apos;s settings to pick a
            different one.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="font-mono text-xs text-muted">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </p>

      {onWrongChain ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted">
            Your wallet is on the wrong network — Argus runs on {activeChain.name}.
          </p>
          <button
            onClick={() => switchChainAsync({ chainId: activeChain.id }).catch((err) => setError(err.message))}
            disabled={isSwitchingChain}
            className={`flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
          >
            {isSwitchingChain && <Spinner size={14} />}
            {isSwitchingChain ? "Switching…" : `Switch to ${activeChain.name}`}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={signIn}
            disabled={isSigningIn}
            className={`flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm text-background ${PRESS_FEEDBACK} disabled:opacity-50`}
          >
            {isSigningIn && <Spinner size={14} />}
            {isSigningIn ? "Signing in…" : "Sign in with Wallet"}
          </button>
          <button onClick={disconnectAndReset} className={`rounded-md bg-surface px-4 py-2 text-sm ${PRESS_FEEDBACK}`}>
            Disconnect
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

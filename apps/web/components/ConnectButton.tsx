"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";

export function ConnectButton({ onSignedIn }: { onSignedIn: (wallet: string) => void }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];
    return (
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => injectedConnector && connect({ connector: injectedConnector })}
          disabled={isConnecting || !injectedConnector}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {isConnecting ? "Connecting…" : "Connect Wallet"}
        </button>
        {!injectedConnector && (
          <p className="text-xs text-muted">No injected wallet found — install MetaMask or Rabby.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="font-mono text-xs text-muted">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </p>
      <div className="flex gap-2">
        <button
          onClick={signIn}
          disabled={isSigningIn}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {isSigningIn ? "Signing in…" : "Sign in with Wallet"}
        </button>
        <button onClick={() => disconnect()} className="rounded-md border border-border px-4 py-2 text-sm">
          Disconnect
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

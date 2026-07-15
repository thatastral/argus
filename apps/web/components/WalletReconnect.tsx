"use client";

import { useConnect } from "wagmi";

/// Argus's server session (httpOnly cookie, 7-day TTL) can outlive the actual wagmi/wallet
/// connection — e.g. after a browser restart the extension drops its site connection while
/// the session cookie is still valid. Any step that needs to write on-chain must check
/// isConnected itself rather than assuming "has a session" implies "wallet is live", or
/// writeContractAsync throws ConnectorNotConnectedError with no recovery path in the UI.
/// Render this in place of the normal action UI whenever `!isConnected`.
export function WalletReconnect() {
  const { connect, connectors, isPending } = useConnect();

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3">
      <p className="text-xs text-muted">Your wallet disconnected — reconnect to continue.</p>
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          onClick={() => connect({ connector })}
          disabled={isPending}
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
        >
          {isPending ? "Connecting…" : `Reconnect ${connector.name}`}
        </button>
      ))}
    </div>
  );
}

/// Shared "make a caught error safe to show the user" helper. This app's on-chain writes throw
/// viem's BaseError, whose raw `.message` is a multi-paragraph RPC dump (Request Arguments, the
/// raw ABI-encoded calldata, a docs link, the package version) — confirmed live as a full raw
/// dump rendering verbatim in the UI. Simply falling back to viem's own `shortMessage` fixes the
/// wall-of-text problem but still leaves something like "An unknown RPC error occurred.", which
/// doesn't tell a user what actually happened or what to do about it. This instead maps the real,
/// recurring causes to a specific, actionable sentence:
///   1. This app's own Solidity custom errors (contracts/src/*.sol) — viem decodes a revert's
///      error name into the error text whenever the ABI is available, so a plain substring check
///      for e.g. "TooManyHabits" reliably catches it (the same technique useDeleteHabit.ts
///      already uses internally for InvalidHabitIndex, just for control flow there instead of a
///      message shown to the user).
///   2. A handful of common wallet/RPC-level failures viem has stable, well-known message text
///      for: the user declining the wallet prompt, not having enough MON to cover gas, being on
///      the wrong chain, or the wallet extension dropping the connection mid-request (confirmed
///      live as "Details: Plugin Closed").
/// Falls back to viem's shortMessage, then a plain Error's own .message (already user-facing text
/// written by our own code, e.g. "Could not save profile"), then the caller's fallback — which
/// also catches a raw dump none of the above matched: some wallet providers (confirmed live, an
/// in-app mobile wallet browser) wrap RPC errors in ethers.js's own shape instead of viem's — no
/// `.shortMessage`, and `.message` is an equally long dump (CALL_EXCEPTION, raw calldata,
/// "unknown custom error" when the provider can't even decode the revert selector). Any message
/// that long was never meant for a person to read regardless of which library produced it, so
/// anything over ~300 characters uses the caller's own fallback instead — already specific to
/// the action being attempted (e.g. "Failed to deploy Accountability Wallet"), more useful than a
/// generic catch-all phrase would be.
const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  // AccountabilityWallet.sol
  WalletAlreadyDeployed: "You already have an Accountability Wallet.",
  NotOwner: "Only the wallet that owns this Accountability Wallet can do this.",
  InsufficientBalance: "That amount exceeds your Available balance.",
  TransferFailed: "The transfer failed on-chain — try again in a moment.",
  WrongAssetPath: "This doesn't match the asset your Accountability Wallet holds.",
  // HabitManager.sol
  TooManyHabits: "You've reached the 3 active habit limit — deactivate one first.",
  InvalidHabitIndex: "This habit no longer exists on-chain — it may have already been removed.",
  NotVerifier: "Only Argus's verification service can complete a habit.",
  NoHabitsYet: "Create a habit first — there's nothing to settle yet.",
  NothingToSettle: "Everything is already settled — nothing to do here.",
};

const KNOWN_CAUSES: { match: string; message: string }[] = [
  { match: "User rejected the request", message: "You declined the request in your wallet." },
  {
    match: "exceeds the balance of the account",
    message: "Your wallet doesn't have enough MON to cover gas for this transaction.",
  },
  {
    match: "does not match the target chain",
    message: "Your wallet is on the wrong network — switch to Monad Testnet and try again.",
  },
  {
    match: "Plugin Closed",
    message: "Wallet extension closed unexpectedly — reconnect and try again.",
  },
  {
    match: "ConnectorNotConnectedError",
    message: "Wallet disconnected — reconnect and try again.",
  },
];

export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const shortMessage = (err as { shortMessage?: unknown }).shortMessage;
    const fullText = `${err.message} ${typeof shortMessage === "string" ? shortMessage : ""}`;

    for (const [errorName, message] of Object.entries(CONTRACT_ERROR_MESSAGES)) {
      if (fullText.includes(errorName)) return message;
    }
    for (const { match, message } of KNOWN_CAUSES) {
      if (fullText.includes(match)) return message;
    }

    if (typeof shortMessage === "string" && shortMessage.trim()) {
      return shortMessage;
    }
    if (err.message && err.message.length <= 300) {
      return err.message;
    }
    return fallback;
  }
  return fallback;
}

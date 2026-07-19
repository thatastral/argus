/// Shared "make a caught error safe to show the user" helper. Every write-hook/component here
/// catches with `err instanceof Error ? err.message : fallback` — fine for a plain Error thrown
/// by our own code, but viem's BaseError (thrown by every writeContractAsync/readContract
/// failure) packs a multi-paragraph `.message`: the one-sentence summary followed by Request
/// Arguments, Contract Call, the raw ABI-encoded calldata, a docs link, and the package version,
/// all concatenated. That whole blob was rendering verbatim in the UI — confirmed live: a
/// dropped wallet-extension connection mid-request ("Details: Plugin Closed") surfaced as a full
/// raw RPC dump instead of a short, readable message. viem's BaseError separately exposes
/// `shortMessage` — just the first sentence — so prefer that whenever it's present; a plain
/// `Error` thrown by our own code (e.g. "Could not save profile") has no such property and
/// passes through unchanged.
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const shortMessage = (err as { shortMessage?: unknown }).shortMessage;
    if (typeof shortMessage === "string" && shortMessage.trim()) {
      return shortMessage;
    }
    return err.message || fallback;
  }
  return fallback;
}

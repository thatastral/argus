import { cookieStorage, createConfig, createStorage, http, injected } from "wagmi";
import { monad, monadTestnet } from "wagmi/chains";

// Testnet first during development (PRD: build on testnet, deploy to mainnet).
// Flip NEXT_PUBLIC_MONAD_NETWORK to "mainnet" once contracts are deployed there.
const isMainnet = process.env.NEXT_PUBLIC_MONAD_NETWORK === "mainnet";

export const chains = isMainnet ? ([monad, monadTestnet] as const) : ([monadTestnet, monad] as const);

export const activeChain = chains[0];

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  // Monad's ~400ms block time (real-time finality in ~800ms) makes wagmi's 4s default polling
  // interval needlessly slow for anything watching on-chain state (balances, streak, habit
  // completions) — confirmed live as a real "why hasn't my balance updated after that deposit"
  // gap. 1s keeps every watched read close to real time without meaningfully increasing RPC load.
  pollingInterval: 1_000,
  // useAccountabilityWallet.ts alone fires up to 8 separate contract reads for one wallet (vault
  // address, asset, balance, decimals, available/committed/savings-vault amount + unlock), most
  // landing in the same render tick once their `enabled` gates flip true. Without this, each was
  // its own eth_call round-trip; with it, viem automatically batches same-tick reads into one
  // Multicall3.aggregate3 call instead — this was the single biggest lever on "how long until the
  // wallet screen actually shows real numbers." Both monad/monadTestnet's chain definitions
  // already carry the canonical Multicall3 address (viem's built-in `contracts.multicall3`), so
  // this works with no extra deployment/wiring.
  batch: { multicall: true },
  transports: {
    // `batch: true` here is transport-level JSON-RPC batching — coalesces every RPC call issued
    // in the same tick (eth_getBalance, eth_chainId, ...) into one HTTP POST instead of one round
    // trip each. Multicall3 above only covers contract reads (readContract); this also covers
    // useBalance's native-MON read and anything else Multicall3 can't wrap.
    [monad.id]: http("https://rpc.monad.xyz", { batch: true }),
    [monadTestnet.id]: http("https://testnet-rpc.monad.xyz", { batch: true }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

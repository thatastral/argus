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
  transports: {
    [monad.id]: http("https://rpc.monad.xyz"),
    [monadTestnet.id]: http("https://testnet-rpc.monad.xyz"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

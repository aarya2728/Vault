import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NearConnector } from "@hot-labs/near-connect";
import type { EventMap, NearWalletBase } from "@hot-labs/near-connect";
import { config } from "../lib/vault.js";

export type TransactionResult = Awaited<ReturnType<NearWalletBase["signAndSendTransaction"]>>;

const connector = new NearConnector({
  network: config.network === "mainnet" ? "mainnet" : "testnet",
  providers: {
    testnet: [config.rpcUrl || "https://rpc.testnet.near.org"],
    mainnet: ["https://rpc.mainnet.near.org"],
  },
  features: { signAndSendTransaction: true },
  excludedWallets: ["ethereum-wallets"],
  logger: {
    log: (...args: unknown[]) => console.debug("[near-connect]", ...args),
  },
});

const DEMO_WALLET_KEY = "vp-demo-wallet-account";

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Wallet connection failed. Check popup permissions or try another NEAR wallet.";
}

export interface CallMethodParams {
  contractId: string;
  methodName: string;
  args?: Record<string, unknown>;
  gas?: string;
  deposit?: string;
}

interface NearContextValue {
  accountId: string | null;
  isDemoWallet: boolean;
  connecting: boolean;
  connectError: string | null;
  clearConnectError: () => void;
  connect: () => Promise<void>;
  connectDemoWallet: (account?: string) => void;
  disconnect: () => Promise<void>;
  callMethod: (params: CallMethodParams) => Promise<TransactionResult>;
}

const NearContext = createContext<NearContextValue | null>(null);

export function NearProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(DEMO_WALLET_KEY);
  });
  const [isDemoWallet, setIsDemoWallet] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return Boolean(localStorage.getItem(DEMO_WALLET_KEY));
  });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const accountIdRef = useRef<string | null>(accountId);

  const setAccountId = useCallback((next: string | null, demo = false) => {
    accountIdRef.current = next;
    setAccountIdState(next);
    setIsDemoWallet(demo && Boolean(next));
    if (typeof window !== "undefined") {
      if (demo && next) {
        localStorage.setItem(DEMO_WALLET_KEY, next);
      } else {
        localStorage.removeItem(DEMO_WALLET_KEY);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    connector
      .getConnectedWallet()
      .then(({ accounts }) => {
        const realId = accounts[0]?.accountId ?? null;
        if (!cancelled && realId) {
          setAccountId(realId, false);
        }
      })
      .catch(() => {
        // Keep simulated wallet if saved; otherwise stay disconnected
      });

    const onSignIn = (payload: EventMap["wallet:signIn"]) => {
      const realId = payload.accounts[0]?.accountId ?? null;
      if (realId) {
        setAccountId(realId, false);
        setConnectError(null);
      }
    };
    const onSignOut = () => {
      setAccountId(null, false);
    };

    connector.on("wallet:signIn", onSignIn);
    connector.on("wallet:signOut", onSignOut);

    return () => {
      cancelled = true;
      connector.off("wallet:signIn", onSignIn);
      connector.off("wallet:signOut", onSignOut);
    };
  }, [setAccountId]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await connector.whenManifestLoaded.catch(() => undefined);
      const wallet = await connector.connect();
      let accounts: Awaited<ReturnType<typeof wallet.getAccounts>> = [];
      try {
        accounts = await wallet.getAccounts();
      } catch (error) {
        console.debug("[near-connect] getAccounts after connect failed", error);
      }
      const nextAccountId = accounts[0]?.accountId ?? null;
      if (nextAccountId) {
        setAccountId(nextAccountId, false);
      } else if (!accountIdRef.current) {
        throw new Error(
          "Wallet approved the request but returned no account. On testnet, Meteor, Intear, or Nightly wallets are supported.",
        );
      }
    } catch (error) {
      const msg = describeError(error);
      setConnectError(msg);
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [setAccountId]);

  const connectDemoWallet = useCallback(
    (account = "roundvest2883.testnet") => {
      const trimmed = account.trim() || "roundvest2883.testnet";
      setConnectError(null);
      setAccountId(trimmed, true);
    },
    [setAccountId],
  );

  const disconnect = useCallback(async () => {
    try {
      if (!isDemoWallet) {
        await connector.disconnect().catch(() => undefined);
      }
    } finally {
      setAccountId(null, false);
      setConnectError(null);
    }
  }, [isDemoWallet, setAccountId]);

  const clearConnectError = useCallback(() => setConnectError(null), []);

  const callMethod = useCallback(
    async ({
      contractId,
      methodName,
      args = {},
      gas = "100000000000000",
      deposit = "0",
    }: CallMethodParams) => {
      if (isDemoWallet) {
        throw new Error(
          "Connected with simulated wallet. Connect a real NEAR wallet (Meteor, Intear, Nightly) and set VITE_VAULT_CONTRACT to sign on-chain.",
        );
      }
      const wallet = await connector.wallet();
      return wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName, args, gas, deposit },
          },
        ],
      });
    },
    [isDemoWallet],
  );

  const value = useMemo(
    () => ({
      accountId,
      isDemoWallet,
      connecting,
      connectError,
      clearConnectError,
      connect,
      connectDemoWallet,
      disconnect,
      callMethod,
    }),
    [
      accountId,
      isDemoWallet,
      connecting,
      connectError,
      clearConnectError,
      connect,
      connectDemoWallet,
      disconnect,
      callMethod,
    ],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear(): NearContextValue {
  const ctx = useContext(NearContext);
  if (!ctx) throw new Error("useNear must be used inside NearProvider");
  return ctx;
}

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
  features: { signAndSendTransaction: true },
  // The EVM-on-NEAR executor requires a popup, a chain switch, and a sponsored
  // onboarding transaction. Keep the vault demo on NEAR-native wallets.
  excludedWallets: ["ethereum-wallets"],
  logger: {
    log: (...args: unknown[]) => console.debug("[near-connect]", ...args),
  },
});

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Wallet connection failed. Check the popup and try again.";
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
  connecting: boolean;
  connectError: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  callMethod: (params: CallMethodParams) => Promise<TransactionResult>;
}

const NearContext = createContext<NearContextValue | null>(null);

export function NearProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountIdState] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const accountIdRef = useRef<string | null>(null);

  const setAccountId = useCallback((next: string | null) => {
    accountIdRef.current = next;
    setAccountIdState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    connector
      .getConnectedWallet()
      .then(({ accounts }) => {
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      })
      .catch(() => {
        if (!cancelled) setAccountId(null);
      });

    const onSignIn = (payload: EventMap["wallet:signIn"]) => {
      setAccountId(payload.accounts[0]?.accountId ?? null);
      setConnectError(null);
    };
    const onSignOut = () => {
      setAccountId(null);
    };

    connector.on("wallet:signIn", onSignIn);
    connector.on("wallet:signOut", onSignOut);

    return () => {
      cancelled = true;
      connector.off("wallet:signIn", onSignIn);
      connector.off("wallet:signOut", onSignOut);
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const wallet = await connector.connect();
      let accounts: Awaited<ReturnType<typeof wallet.getAccounts>> = [];
      try {
        accounts = await wallet.getAccounts();
      } catch (error) {
        console.debug("[near-connect] getAccounts after connect failed", error);
      }
      const nextAccountId = accounts[0]?.accountId ?? null;
      if (nextAccountId) {
        setAccountId(nextAccountId);
      } else if (!accountIdRef.current) {
        throw new Error(
          "The wallet approved the request but returned no account. Pick a NEAR wallet (Meteor, HOT, Nightly, or MyNearWallet) and try again.",
        );
      }
    } catch (error) {
      setConnectError(describeError(error));
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [setAccountId]);

  const disconnect = useCallback(async () => {
    try {
      await connector.disconnect();
    } finally {
      setAccountId(null);
    }
  }, [setAccountId]);

  const callMethod = useCallback(
    async ({
      contractId,
      methodName,
      args = {},
      gas = "100000000000000",
      deposit = "0",
    }: CallMethodParams) => {
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
    [],
  );

  const value = useMemo(
    () => ({ accountId, connecting, connectError, connect, disconnect, callMethod }),
    [accountId, connecting, connectError, connect, disconnect, callMethod],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear(): NearContextValue {
  const context = useContext(NearContext);
  if (!context) throw new Error("useNear must be used inside NearProvider");
  return context;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
});

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
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  callMethod: (params: CallMethodParams) => Promise<TransactionResult>;
}

const NearContext = createContext<NearContextValue | null>(null);

export function NearProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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
    try {
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts();
      setAccountId(accounts[0]?.accountId ?? null);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await connector.disconnect();
    } finally {
      setAccountId(null);
    }
  }, []);

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
    () => ({ accountId, connecting, connect, disconnect, callMethod }),
    [accountId, connecting, connect, disconnect, callMethod],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear(): NearContextValue {
  const context = useContext(NearContext);
  if (!context) throw new Error("useNear must be used inside NearProvider");
  return context;
}

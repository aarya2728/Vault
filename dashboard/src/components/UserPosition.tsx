import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNear, type TransactionResult } from "../providers/NearProvider.js";
import {
  assetsForShares,
  config,
  explorerTxUrl,
  fetchFtBalance,
  fetchShares,
  fetchStorageBalance,
  formatAmount,
  parseAmount,
  sharesForAssets,
  shorten,
  type VaultSummary,
} from "../lib/vault.js";

const GAS = "100000000000000";
const STORAGE_GAS = "30000000000000";
const STORAGE_DEPOSIT = "1250000000000000000000";

function transactionHash(result: TransactionResult): string | null {
  const outcome = result as unknown as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
  };
  return outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? null;
}

export function UserPosition({
  summary,
  onRefreshed,
  demo = false,
}: {
  summary: VaultSummary;
  onRefreshed: () => void;
  demo?: boolean;
}) {
  const { accountId, callMethod } = useNear();
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<"deposit" | "withdraw" | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");

  const load = useCallback(async () => {
    if (demo) {
      setTokenBalance(18_420_000_000n);
      setShares(75_000_000_000n);
      setReadError(null);
      setLoading(false);
      return;
    }
    if (!accountId) return;
    setLoading(true);
    try {
      const [balanceRaw, sharesRaw] = await Promise.all([
        fetchFtBalance(summary.token, accountId),
        fetchShares(accountId),
      ]);
      setTokenBalance(BigInt(balanceRaw));
      setShares(BigInt(sharesRaw));
      setReadError(null);
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [accountId, demo, summary.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAssets = BigInt(summary.total_assets);
  const totalShares = BigInt(summary.total_shares);
  const positionValue = shares === null ? 0n : assetsForShares(shares, totalAssets, totalShares);

  async function handleDeposit(event: FormEvent) {
    event.preventDefault();
    setTxError(null);
    setTxHash(null);

    let amount: bigint;
    try {
      amount = parseAmount(depositInput);
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    if (amount <= 0n) {
      setTxError("enter an amount greater than zero");
      return;
    }
    if (tokenBalance !== null && amount > tokenBalance) {
      setTxError(`amount exceeds your ${config.tokenSymbol} balance`);
      return;
    }
    if (!config.vaultContract) {
      setTxError("VITE_VAULT_CONTRACT is not set");
      return;
    }

    setPending("deposit");
    try {
      const vaultStorage = await fetchStorageBalance(summary.token, config.vaultContract);
      if (!vaultStorage) {
        throw new Error(
          `The vault is not storage-registered with ${config.tokenSymbol}. Run the storage_deposit command printed by the deploy script, then retry.`,
        );
      }

      const result = await callMethod({
        contractId: summary.token,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: config.vaultContract,
          amount: amount.toString(),
          msg: "",
        },
        gas: GAS,
        deposit: "1",
      });
      setTxHash(transactionHash(result));
      setDepositInput("");
      await load();
      onRefreshed();
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  async function handleWithdraw(event: FormEvent) {
    event.preventDefault();
    setTxError(null);
    setTxHash(null);

    if (!accountId) {
      setTxError("connect a wallet first");
      return;
    }

    let assets: bigint;
    try {
      assets = parseAmount(withdrawInput);
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    if (assets <= 0n) {
      setTxError("enter an amount greater than zero");
      return;
    }
    if (shares === null || shares <= 0n) {
      setTxError("no vault shares to withdraw");
      return;
    }
    if (!config.vaultContract) {
      setTxError("VITE_VAULT_CONTRACT is not set");
      return;
    }

    const idleAssets = BigInt(summary.idle_assets);
    if (assets > idleAssets) {
      setTxError(
        `Withdrawal of ${formatAmount(assets)} ${config.tokenSymbol} exceeds available idle liquidity (${formatAmount(idleAssets)} ${config.tokenSymbol}). Remaining capital is deployed in cross-chain rebalance. You can withdraw up to ${formatAmount(idleAssets)} immediately, or wait for settlement.`,
      );
      return;
    }

    const requested = assets >= positionValue ? shares : sharesForAssets(assets, totalAssets, totalShares);
    const sharesToBurn = requested > shares ? shares : requested;
    if (sharesToBurn <= 0n) {
      setTxError("amount is too small to withdraw");
      return;
    }

    setPending("withdraw");
    try {
      if (!(await fetchStorageBalance(summary.token, accountId))) {
        await callMethod({
          contractId: summary.token,
          methodName: "storage_deposit",
          args: { account_id: accountId },
          gas: STORAGE_GAS,
          deposit: STORAGE_DEPOSIT,
        });
      }

      const result = await callMethod({
        contractId: config.vaultContract,
        methodName: "withdraw",
        args: { shares: sharesToBurn.toString() },
        gas: GAS,
        deposit: "0",
      });
      setTxHash(transactionHash(result));
      setWithdrawInput("");
      await load();
      onRefreshed();
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  const symbol = config.tokenSymbol;
  const idleAssets = BigInt(summary.idle_assets);
  const deployedAssets = BigInt(summary.deployed_assets);
  const totalCapital = idleAssets + deployedAssets;
  const idlePct = totalCapital > 0n ? Number((idleAssets * 100n) / totalCapital) : 100;
  const maxInstant = positionValue < idleAssets ? positionValue : idleAssets;
  const depositBlocked = demo || summary.paused || pending !== null;
  const withdrawBlocked =
    demo || pending !== null || shares === null || shares <= 0n;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Your position</h2>
        <span className="muted">
          {demo
            ? "demo position"
            : loading
            ? "reading..."
            : accountId
            ? shorten(accountId, 12, 8)
            : ""}
        </span>
      </header>

      {demo && (
        <p className="muted small demo-note">
          Sample LP position. Connect a wallet and configure a vault contract to deposit or
          withdraw for real.
        </p>
      )}

      <div className="position-grid">
        <div>
          <span className="stat-label">Wallet balance</span>
          <strong>{tokenBalance === null ? "-" : `${formatAmount(tokenBalance)} ${symbol}`}</strong>
        </div>
        <div>
          <span className="stat-label">Vault shares</span>
          <strong>{shares === null ? "-" : formatAmount(shares)}</strong>
        </div>
        <div>
          <span className="stat-label">Position value</span>
          <strong>{shares === null ? "-" : `${formatAmount(positionValue)} ${symbol}`}</strong>
        </div>
      </div>

      <div className="capital-split">
        <div
          className="capital-split-bar"
          role="img"
          aria-label={`${idlePct}% idle, ${100 - idlePct}% deployed`}
        >
          <span className="capital-split-idle" style={{ width: `${idlePct}%` }} />
        </div>
        <div className="capital-split-legend">
          <span>
            <span className="split-dot split-dot-idle" /> Idle{" "}
            <strong>
              {formatAmount(idleAssets)} {symbol}
            </strong>
          </span>
          <span>
            <span className="split-dot split-dot-deployed" /> Deployed cross-chain{" "}
            <strong>
              {formatAmount(deployedAssets)} {symbol}
            </strong>
          </span>
        </div>
      </div>

      {readError && !demo && <p className="form-error">Read failed: {readError}</p>}

      <div className="action-grid">
        <form className="action-card" onSubmit={(event) => void handleDeposit(event)}>
          <h3>Deposit</h3>
          <p className="muted small">
            Send {symbol} to the vault. Shares are minted at the current exchange rate.
          </p>
          <div className="field">
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={depositInput}
              onChange={(event) => setDepositInput(event.target.value)}
              disabled={depositBlocked}
            />
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                if (tokenBalance !== null) setDepositInput(formatAmount(tokenBalance));
              }}
              disabled={depositBlocked || tokenBalance === null || tokenBalance === 0n}
            >
              Max
            </button>
          </div>
          <button
            type="submit"
            className="button button-primary"
            disabled={depositBlocked || depositInput.trim() === ""}
          >
            {pending === "deposit" ? "Depositing..." : `Deposit ${symbol}`}
          </button>
          {summary.paused && <p className="muted small">Deposits are blocked while the vault is paused.</p>}
        </form>

        <form className="action-card" onSubmit={(event) => void handleWithdraw(event)}>
          <h3>Withdraw</h3>
          <p className="muted small">
            Burn shares for idle {symbol}. Withdrawals stay open while the vault is paused. If this
            account has never held {symbol}, the first withdrawal also registers token storage
            (0.00125 NEAR).
          </p>
          <div className="field">
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={withdrawInput}
              onChange={(event) => setWithdrawInput(event.target.value)}
              disabled={demo || pending !== null}
            />
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setWithdrawInput(formatAmount(maxInstant))}
              disabled={demo || pending !== null || maxInstant === 0n}
              title="Withdraw up to immediately available idle liquidity"
            >
              Instant Max
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setWithdrawInput(formatAmount(positionValue))}
              disabled={demo || pending !== null || positionValue === 0n}
            >
              Max
            </button>
          </div>
          {idleAssets < positionValue && (
            <p className="muted small" style={{ color: "var(--color-warn, #e5a93c)" }}>
              Notice: {formatAmount(idleAssets)} {symbol} currently idle for instant exit. (
              {formatAmount(deployedAssets)} {symbol} deployed across the vault&apos;s cross-chain
              position).
            </p>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={withdrawBlocked || withdrawInput.trim() === ""}
          >
            {pending === "withdraw" ? "Withdrawing..." : `Withdraw ${symbol}`}
          </button>
        </form>
      </div>

      {txError && <p className="form-error">{txError}</p>}
      {txHash && (
        <p className="muted small">
          Transaction:{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {shorten(txHash, 10, 8)}
          </a>
        </p>
      )}
    </section>
  );
}

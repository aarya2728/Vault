import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNear, type TransactionResult } from "../providers/NearProvider.js";
import {
  assetsForShares,
  config,
  explorerTxUrl,
  fetchFtBalance,
  fetchShares,
  fetchStorageBalance,
  fetchWithdrawalRequest,
  formatAmount,
  formatPrettyAmount,
  formatPrettyUsd,
  formatSharePrice,
  parseAmount,
  sharesForAssets,
  shorten,
  type QueuedWithdrawal,
  type VaultSummary,
} from "../lib/vault.js";
import { DEMO_QUEUED_WITHDRAWAL } from "../lib/demo.js";
import { ArrowRightIcon, HourglassIcon, InfoIcon, WalletIcon } from "./Icons.js";

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
  onDemoMutate,
  demo = false,
}: {
  summary: VaultSummary;
  onRefreshed: () => void;
  onDemoMutate?: (delta: {
    deltaAssets?: bigint;
    deltaShares?: bigint;
    deltaQueuedShares?: bigint;
  }) => void;
  demo?: boolean;
}) {
  const { accountId, isDemoWallet, callMethod } = useNear();
  const isSimulated = demo || isDemoWallet || !config.vaultContract;

  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(18_420_000_000n);
  const [shares, setShares] = useState<bigint | null>(75_000_000_000n);
  const [queuedWithdrawal, setQueuedWithdrawal] = useState<QueuedWithdrawal | null>(
    DEMO_QUEUED_WITHDRAWAL,
  );
  const [pending, setPending] = useState<"deposit" | "withdraw" | "queue" | "claim" | "cancel" | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txNotice, setTxNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("5000");

  const load = useCallback(async () => {
    if (isSimulated) {
      setReadError(null);
      return;
    }
    if (!accountId) return;
    try {
      const [balanceRaw, sharesRaw, queuedReq] = await Promise.all([
        fetchFtBalance(summary.token, accountId),
        fetchShares(accountId),
        fetchWithdrawalRequest(accountId).catch(() => null),
      ]);
      setTokenBalance(BigInt(balanceRaw));
      setShares(BigInt(sharesRaw));
      setQueuedWithdrawal(queuedReq);
      setReadError(null);
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [accountId, isSimulated, summary.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAssets = BigInt(summary.total_assets);
  const totalShares = BigInt(summary.total_shares);
  const idleAssets = BigInt(summary.idle_assets);
  const deployedAssets = BigInt(summary.deployed_assets);
  const positionValue = shares === null ? 0n : assetsForShares(shares, totalAssets, totalShares);
  const poolSharePct =
    shares !== null && totalShares > 0n
      ? ((Number(shares) / Number(totalShares)) * 100).toFixed(1)
      : "0.0";
  const accruedGain = shares !== null && positionValue > shares ? positionValue - shares : 0n;
  const symbol = config.tokenSymbol;

  let parsedInput = 0n;
  try {
    if (amountInput.trim() !== "") {
      parsedInput = parseAmount(amountInput);
    }
  } catch {
    parsedInput = 0n;
  }

  const estimatedSharesOut =
    mode === "deposit" && parsedInput > 0n
      ? sharesForAssets(parsedInput, totalAssets, totalShares)
      : 0n;
  const withdrawExceedsIdle = mode === "withdraw" && parsedInput > 0n && parsedInput > idleAssets;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTxError(null);
    setTxNotice(null);
    setTxHash(null);

    if (parsedInput <= 0n) {
      setTxError("Enter an amount greater than zero.");
      return;
    }

    if (mode === "deposit") {
      if (tokenBalance !== null && parsedInput > tokenBalance) {
        setTxError(`Amount exceeds your ${symbol} balance.`);
        return;
      }

      if (isSimulated) {
        const minted = sharesForAssets(parsedInput, totalAssets, totalShares);
        setPending("deposit");
        setTimeout(() => {
          setTokenBalance((prev) => (prev ?? 0n) - parsedInput);
          setShares((prev) => (prev ?? 0n) + minted);
          onDemoMutate?.({ deltaAssets: parsedInput, deltaShares: minted });
          setTxNotice(
            `Simulated deposit confirmed: +${formatPrettyAmount(minted)} VP-${symbol} minted (${accountId ?? "demo session"})`,
          );
          setPending(null);
        }, 300);
        return;
      }

      if (!accountId) {
        setTxError("Connect your NEAR wallet in the top-right bar to sign on-chain.");
        return;
      }
      if (!config.vaultContract) {
        setTxError("VITE_VAULT_CONTRACT is not configured.");
        return;
      }

      setPending("deposit");
      try {
        const vaultStorage = await fetchStorageBalance(summary.token, config.vaultContract);
        if (!vaultStorage) {
          throw new Error(
            `The vault is not storage-registered with ${symbol}. Run storage_deposit first.`,
          );
        }
        const result = await callMethod({
          contractId: summary.token,
          methodName: "ft_transfer_call",
          args: {
            receiver_id: config.vaultContract,
            amount: parsedInput.toString(),
            msg: "",
          },
          gas: GAS,
          deposit: "1",
        });
        setTxHash(transactionHash(result));
        setAmountInput("");
        await load();
        onRefreshed();
      } catch (cause) {
        setTxError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(null);
      }
      return;
    }

    // Withdraw or Queue mode
    if (withdrawExceedsIdle) {
      await handleQueueWithdrawal();
      return;
    }

    if (shares === null || shares <= 0n) {
      setTxError("No vault shares available to withdraw.");
      return;
    }

    const requested =
      parsedInput >= positionValue ? shares : sharesForAssets(parsedInput, totalAssets, totalShares);
    const sharesToBurn = requested > shares ? shares : requested;
    if (sharesToBurn <= 0n) {
      setTxError("Amount is too small to withdraw.");
      return;
    }

    if (isSimulated) {
      setPending("withdraw");
      setTimeout(() => {
        setShares((prev) => (prev ?? 0n) - sharesToBurn);
        setTokenBalance((prev) => (prev ?? 0n) + parsedInput);
        onDemoMutate?.({ deltaAssets: -parsedInput, deltaShares: -sharesToBurn });
        setTxNotice(
          `Simulated withdrawal confirmed: +${formatPrettyAmount(parsedInput)} ${symbol} returned to wallet`,
        );
        setPending(null);
      }, 300);
      return;
    }

    if (!accountId || !config.vaultContract) {
      setTxError("Connect your NEAR wallet first.");
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
      setAmountInput("");
      await load();
      onRefreshed();
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  async function handleQueueWithdrawal() {
    setTxError(null);
    setTxNotice(null);
    setTxHash(null);

    if (shares === null || shares <= 0n) {
      setTxError("No vault shares available to queue.");
      return;
    }

    const requested =
      parsedInput >= positionValue ? shares : sharesForAssets(parsedInput, totalAssets, totalShares);
    const sharesToQueue = requested > shares ? shares : requested;
    if (sharesToQueue <= 0n) {
      setTxError("Enter a valid amount to queue.");
      return;
    }

    if (isSimulated) {
      setPending("queue");
      setTimeout(() => {
        setShares((prev) => (prev ?? 0n) - sharesToQueue);
        setQueuedWithdrawal({
          account_id: accountId ?? "roundvest2883.testnet",
          shares: sharesToQueue.toString(),
          requested_at_ms: Date.now(),
          epoch: summary.current_epoch ?? 4,
          status: "pending",
          assets_allocated: "0",
        });
        onDemoMutate?.({ deltaQueuedShares: sharesToQueue });
        setTxNotice(
          `Queued ${formatPrettyAmount(sharesToQueue)} VP-${symbol} into Epoch #${summary.current_epoch ?? 4} Redemption Queue`,
        );
        setPending(null);
      }, 300);
      return;
    }

    if (!accountId || !config.vaultContract) {
      setTxError("Connect your NEAR wallet first.");
      return;
    }

    setPending("queue");
    try {
      const result = await callMethod({
        contractId: config.vaultContract,
        methodName: "request_withdrawal",
        args: { shares: sharesToQueue.toString() },
        gas: GAS,
        deposit: "0",
      });
      setTxHash(transactionHash(result));
      setAmountInput("");
      await load();
      onRefreshed();
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  async function handleClaimWithdrawal() {
    setTxError(null);
    setTxNotice(null);
    setTxHash(null);

    if (isSimulated) {
      setPending("claim");
      setTimeout(() => {
        const claimedAssets = queuedEstAssets;
        const claimedShares = queuedSharesVal;
        setQueuedWithdrawal(null);
        setTokenBalance((prev) => (prev ?? 0n) + claimedAssets);
        onDemoMutate?.({
          deltaAssets: -claimedAssets,
          deltaShares: -claimedShares,
          deltaQueuedShares: -claimedShares,
        });
        setTxNotice(`Claimed ${formatPrettyAmount(claimedAssets)} ${symbol} from Epoch queue.`);
        setPending(null);
      }, 300);
      return;
    }

    if (!accountId || !config.vaultContract) return;
    setPending("claim");
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
        methodName: "claim_withdrawal",
        args: {},
        gas: GAS,
        deposit: "0",
      });
      setTxHash(transactionHash(result));
      await load();
      onRefreshed();
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  async function handleCancelWithdrawal() {
    setTxError(null);
    setTxNotice(null);
    setTxHash(null);

    if (isSimulated) {
      setPending("cancel");
      setTimeout(() => {
        const restoredShares = queuedSharesVal;
        setShares((prev) => (prev ?? 0n) + restoredShares);
        setQueuedWithdrawal(null);
        onDemoMutate?.({ deltaQueuedShares: -restoredShares });
        setTxNotice(
          `Cancelled queue ticket; ${formatPrettyAmount(restoredShares)} VP-${symbol} restored.`,
        );
        setPending(null);
      }, 300);
      return;
    }

    if (!accountId || !config.vaultContract) return;
    setPending("cancel");
    try {
      const result = await callMethod({
        contractId: config.vaultContract,
        methodName: "cancel_withdrawal_request",
        args: {},
        gas: GAS,
        deposit: "0",
      });
      setTxHash(transactionHash(result));
      await load();
      onRefreshed();
    } catch (cause) {
      setTxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  const queuedSharesVal = queuedWithdrawal ? BigInt(queuedWithdrawal.shares) : 0n;
  const queuedEstAssets =
    queuedSharesVal > 0n ? assetsForShares(queuedSharesVal, totalAssets, totalShares) : 0n;
  const isQueueReady =
    queuedWithdrawal !== null &&
    (queuedWithdrawal.status === "ready" ||
      (idleAssets >= queuedEstAssets && deployedAssets === 0n));

  return (
    <div className="vp-col-stack">
      {/* Manage Position Card */}
      <section className="vp-card">
        <header className="vp-card-header">
          <div className="vp-card-title-row">
            <WalletIcon width={16} height={16} style={{ color: "var(--emerald-bright)" }} />
            <span>Manage Position</span>
          </div>
          <span className="vp-badge">ERC-4626 SPEC</span>
        </header>

        <div className="vp-pos-stats">
          <div className="vp-pos-stat">
            <span className="vp-pos-stat-label">Wallet Balance</span>
            <span className="vp-pos-stat-val">
              {tokenBalance === null ? "-" : `${formatPrettyAmount(tokenBalance)} ${symbol}`}
            </span>
            <span className="vp-pos-stat-sub">NEAR native NEP-141</span>
          </div>
          <div className="vp-pos-stat">
            <span className="vp-pos-stat-label">Vault Shares</span>
            <span className="vp-pos-stat-val">
              {shares === null ? "-" : `${formatPrettyAmount(shares)} VP`}
            </span>
            <span className="vp-pos-stat-sub">Pool share: {poolSharePct}%</span>
          </div>
          <div className="vp-pos-stat">
            <span className="vp-pos-stat-label">Position Value</span>
            <span className="vp-pos-stat-val is-emerald">
              {shares === null ? "-" : `$${formatPrettyAmount(positionValue)} ${symbol}`}
            </span>
            <span className="vp-pos-stat-sub is-emerald">
              +{formatPrettyUsd(accruedGain)} accrued
            </span>
          </div>
        </div>

        <div className="vp-segmented">
          <button
            type="button"
            className={`vp-seg-btn ${mode === "deposit" ? "is-active" : ""}`}
            onClick={() => {
              setMode("deposit");
              setTxError(null);
              setTxNotice(null);
            }}
          >
            Deposit
          </button>
          <button
            type="button"
            className={`vp-seg-btn ${mode === "withdraw" ? "is-active" : ""}`}
            onClick={() => {
              setMode("withdraw");
              setTxError(null);
              setTxNotice(null);
            }}
          >
            Withdraw
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="vp-amount-header">
            <span>Amount</span>
            <span className="mono">
              {mode === "deposit"
                ? `Available: ${tokenBalance !== null ? formatPrettyAmount(tokenBalance) : "0.00"} ${symbol}`
                : `Idle: ${formatPrettyAmount(idleAssets)} / Max: ${formatPrettyAmount(positionValue)} ${symbol}`}
            </span>
          </div>

          <div className="vp-amount-box">
            <div className="vp-token-chip">
              <span className="vp-token-circle">$</span>
              <span>{symbol}</span>
            </div>
            <div className="vp-amount-controls">
              <input
                className="vp-amount-input"
                inputMode="decimal"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                disabled={pending !== null}
              />
              <button
                type="button"
                className="vp-max-btn"
                onClick={() => {
                  if (mode === "deposit" && tokenBalance !== null) {
                    setAmountInput(formatAmount(tokenBalance));
                  } else if (mode === "withdraw") {
                    setAmountInput(formatAmount(positionValue));
                  }
                }}
                disabled={pending !== null}
              >
                MAX
              </button>
            </div>
          </div>

          <div className="vp-summary-box">
            <div className="vp-summary-row">
              <span style={{ color: "var(--muted)" }}>Exchange Rate Index</span>
              <span className="mono">
                1 VP-{symbol} = {formatSharePrice(summary.share_price)} {symbol}
              </span>
            </div>
            <div className="vp-summary-row">
              <span style={{ color: "var(--muted)" }}>
                {mode === "deposit"
                  ? "Est. Shares Received"
                  : withdrawExceedsIdle
                  ? "Redemption Path"
                  : "Est. Assets Returned"}
              </span>
              <span
                className="mono"
                style={{
                  color: withdrawExceedsIdle ? "var(--amber-bright)" : "var(--emerald-bright)",
                  fontWeight: 600,
                }}
              >
                {mode === "deposit"
                  ? `${formatPrettyAmount(estimatedSharesOut)} VP-${symbol}`
                  : withdrawExceedsIdle
                  ? `Epoch #${summary.current_epoch ?? 4} Unbonding Queue`
                  : `${parsedInput > 0n ? formatPrettyAmount(parsedInput) : "0.00"} ${symbol}`}
              </span>
            </div>
          </div>

          {withdrawExceedsIdle ? (
            <button
              type="submit"
              className="vp-cta-amber"
              disabled={pending !== null || parsedInput <= 0n}
            >
              <span>
                {pending === "queue"
                  ? "Queueing Unbonding..."
                  : `Queue ${amountInput || "0"} ${symbol} for Epoch #${summary.current_epoch ?? 4}`}
              </span>
              <ArrowRightIcon width={15} height={15} />
            </button>
          ) : (
            <button
              type="submit"
              className="vp-cta-white"
              disabled={pending !== null || (mode === "deposit" && summary.paused)}
            >
              <span>
                {pending === "deposit"
                  ? "Depositing..."
                  : pending === "withdraw"
                  ? "Withdrawing..."
                  : mode === "deposit"
                  ? `Deposit ${symbol}`
                  : `Withdraw ${symbol}`}
              </span>
              <ArrowRightIcon width={15} height={15} />
            </button>
          )}
        </form>

        {readError && !isSimulated && <p className="vp-alert-error">RPC Read failed: {readError}</p>}
        {txError && <p className="vp-alert-error">{txError}</p>}
        {txNotice && (
          <div
            className="mono"
            style={{
              marginTop: "0.75rem",
              padding: "0.6rem 0.8rem",
              borderRadius: "7px",
              background: "var(--emerald-bg)",
              border: "1px solid var(--emerald-border)",
              color: "var(--emerald-bright)",
              fontSize: "0.73rem",
            }}
          >
            {txNotice}
          </div>
        )}
        {txHash && (
          <p className="mono" style={{ fontSize: "0.72rem", color: "var(--emerald-bright)", marginTop: "0.65rem" }}>
            Tx confirmed:{" "}
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit" }}
            >
              {shorten(txHash, 10, 8)} ↗
            </a>
          </p>
        )}
      </section>

      {/* Epoch Redemption Queue Card */}
      <section className="vp-card">
        <header className="vp-card-header">
          <div className="vp-card-title-row">
            <HourglassIcon width={15} height={15} style={{ color: "var(--amber-bright)" }} />
            <span>Epoch Redemption Queue</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span className="vp-badge vp-badge-emerald">
              Epoch #{summary.current_epoch ?? 4} Active
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
              Next fill on solver cycle
            </span>
          </div>
        </header>

        {queuedWithdrawal && queuedSharesVal > 0n ? (
          <table className="vp-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Requested Shares</th>
                <th>Est. Value</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono" style={{ color: "var(--muted)" }}>
                  #{queuedWithdrawal.epoch ? `10${queuedWithdrawal.epoch}` : "104"}
                </td>
                <td className="mono" style={{ fontWeight: 500 }}>
                  {formatPrettyAmount(queuedWithdrawal.shares)} VP-{symbol}
                </td>
                <td className="mono" style={{ color: "var(--emerald-bright)", fontWeight: 600 }}>
                  {formatPrettyUsd(queuedEstAssets)}
                </td>
                <td>
                  <span className={`vp-badge ${isQueueReady ? "vp-badge-emerald" : "vp-badge-amber"}`}>
                    <span className={`vp-dot ${isQueueReady ? "" : "vp-dot-amber"}`} />
                    <span>{isQueueReady ? "Ready to Claim" : "Reserved & Settling"}</span>
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  {isQueueReady ? (
                    <button
                      type="button"
                      className="vp-icon-btn"
                      style={{ color: "var(--emerald-bright)", borderColor: "var(--emerald-border)" }}
                      onClick={() => void handleClaimWithdrawal()}
                      disabled={pending !== null}
                    >
                      {pending === "claim" ? "Claiming..." : "Claim"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="vp-icon-btn"
                      onClick={() => void handleCancelWithdrawal()}
                      disabled={pending !== null}
                    >
                      {pending === "cancel" ? "Cancelling..." : "Cancel"}
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            No pending unbonding tickets for this account. Withdrawals exceeding idle liquidity queue here automatically with zero penalty.
          </p>
        )}

        <div className="vp-queue-note">
          <InfoIcon width={14} height={14} style={{ flexShrink: 0 }} />
          <span>Unbonded capital is stored securely in NEAR contract escrow until solver completion.</span>
        </div>
      </section>
    </div>
  );
}

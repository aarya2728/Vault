import type { AgentConfig, QuoteResponse, StatusResponse, TokenInfo } from "./types.js";

class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

async function request<T>(
  config: AgentConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (config.oneClickJwt) {
    headers.Authorization = `Bearer ${config.oneClickJwt}`;
  }

  const response = await fetch(`${config.oneClickBaseUrl}${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) {
    throw new OneClickError(
      `1Click ${path} failed with HTTP ${response.status}`,
      response.status,
      body.slice(0, 500),
    );
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new OneClickError(`1Click ${path} returned invalid JSON`, response.status, body.slice(0, 500));
  }
}

export function getTokens(config: AgentConfig): Promise<TokenInfo[]> {
  return request<TokenInfo[]>(config, "/v0/tokens");
}

export function requestQuote(
  config: AgentConfig,
  amount: bigint,
  slippageBps: number = config.slippageBps,
): Promise<QuoteResponse> {
  const deadline = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const body = {
    dry: config.quoteDry,
    swapType: "EXACT_INPUT",
    slippageTolerance: slippageBps,
    originAsset: config.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: config.destinationAsset,
    amount: amount.toString(),
    recipient: config.destinationRecipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: config.vaultContract,
    refundType: "ORIGIN_CHAIN",
    deadline,
  };

  return request<QuoteResponse>(config, "/v0/quote", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getStatus(config: AgentConfig, depositAddress: string): Promise<StatusResponse> {
  return request<StatusResponse>(
    config,
    `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
}

export function submitDeposit(
  config: AgentConfig,
  depositAddress: string,
  txHash: string,
): Promise<unknown> {
  return request(config, "/v0/deposit/submit", {
    method: "POST",
    body: JSON.stringify({ depositAddress, txHash }),
  });
}

export { OneClickError };

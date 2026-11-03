const DEFAULT_RPC = "https://api.trongrid.io/jsonrpc";
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export type EthBlock = {
  number: string;
  hash: string;
  timestamp: string;
};

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("fetch failed") || msg.includes("network") || msg.includes("timed out");
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt);
}

export class TronRpcClient {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private lastRequestAt = 0;
  private minIntervalMs: number;
  private fetchTimeoutMs: number;

  constructor(options?: {
    url?: string;
    apiKey?: string;
    minIntervalMs?: number;
    fetchTimeoutMs?: number;
  }) {
    this.url = options?.url ?? process.env.TRONGRID_RPC_URL ?? DEFAULT_RPC;
    this.apiKey = options?.apiKey ?? process.env.TRONGRID_API_KEY;
    this.minIntervalMs = options?.minIntervalMs ?? 120;
    this.fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  private async throttle() {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private async fetchJson(body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["TRON-PRO-API-KEY"] = this.apiKey;
    }
    return fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const maxRetries = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this.throttle();
      try {
        const res = await this.fetchJson({ jsonrpc: "2.0", id: 1, method, params });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`TronGrid HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
          continue;
        }
        if (!res.ok) {
          throw new Error(`TronGrid HTTP ${res.status}: ${await res.text()}`);
        }
        const body = (await res.json()) as { result?: T; error?: { message: string } };
        if (body.error) {
          throw new Error(`TronGrid RPC error: ${body.error.message}`);
        }
        return body.result as T;
      } catch (err) {
        lastError = err;
        if (err instanceof Error && err.message.startsWith("TronGrid RPC error")) {
          throw err;
        }
        if (err instanceof Error && err.message.startsWith("TronGrid HTTP") && !/TronGrid HTTP (429|5\d\d)/.test(err.message)) {
          throw err;
        }
        if (!isRetryableFetchError(err) && !(err instanceof Error && /TronGrid HTTP (429|5\d\d)/.test(err.message))) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
    throw new Error(`TronGrid RPC failed after retries: ${method} (${detail})`);
  }

  async getBlockByNumber(blockNumber: number): Promise<EthBlock | null> {
    const hex = `0x${blockNumber.toString(16)}`;
    const result = await this.call<EthBlock | null>("eth_getBlockByNumber", [hex, false]);
    return result;
  }

  async getBlockByNumberBatch(blockNumbers: number[]): Promise<(EthBlock | null)[]> {
    if (blockNumbers.length === 0) return [];
    await this.throttle();
    const payload = blockNumbers.map((n, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: "eth_getBlockByNumber",
      params: [`0x${n.toString(16)}`, false],
    }));
    const maxRetries = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await this.fetchJson(payload);
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`TronGrid batch HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
          continue;
        }
        if (!res.ok) {
          throw new Error(`TronGrid batch HTTP ${res.status}`);
        }
        const body = (await res.json()) as Array<{ id: number; result: EthBlock | null }>;
        const byId = new Map(body.map((r) => [r.id, r.result]));
        return blockNumbers.map((_, i) => byId.get(i + 1) ?? null);
      } catch (err) {
        lastError = err;
        if (err instanceof Error && /^TronGrid batch HTTP [4]/.test(err.message) && !err.message.includes("429")) {
          throw err;
        }
        if (!isRetryableFetchError(err) && !(err instanceof Error && /TronGrid batch HTTP (429|5\d\d)/.test(err.message))) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
    throw new Error(`TronGrid batch failed after retries (${detail})`);
  }

  async getLatestBlockNumber(): Promise<number> {
    const hex = await this.call<string>("eth_blockNumber", []);
    return parseInt(hex, 16);
  }
}

export function blockTimestampSeconds(block: EthBlock): number {
  return parseInt(block.timestamp, 16);
}

/** First block at or after targetTs; blocks ~3s apart. */
export async function findBlockAtOrAfterSecond54(
  rpc: TronRpcClient,
  targetTs: number,
  startBlockHint: number,
): Promise<{ block: EthBlock; blockNumber: number }> {
  let n = Math.max(1, startBlockHint);
  let block = await rpc.getBlockByNumber(n);
  if (!block) {
    throw new Error(`Block ${n} not found`);
  }
  let ts = blockTimestampSeconds(block);
  const delta = Math.round((targetTs - ts) / 3);
  if (delta !== 0) {
    n = Math.max(1, n + delta);
    block = await rpc.getBlockByNumber(n);
    if (!block) throw new Error(`Block ${n} not found after adjust`);
    ts = blockTimestampSeconds(block);
  }
  while (ts < targetTs && n < startBlockHint + 500) {
    n += 1;
    block = await rpc.getBlockByNumber(n);
    if (!block) throw new Error(`Block ${n} not found while walking forward`);
    ts = blockTimestampSeconds(block);
  }
  while (ts > targetTs && n > 1) {
    n -= 1;
    block = await rpc.getBlockByNumber(n);
    if (!block) throw new Error(`Block ${n} not found while walking back`);
    ts = blockTimestampSeconds(block);
  }
  while (ts < targetTs) {
    n += 1;
    block = await rpc.getBlockByNumber(n);
    if (!block) throw new Error(`Block ${n} not found final walk`);
    ts = blockTimestampSeconds(block);
  }
  return { block, blockNumber: n };
}

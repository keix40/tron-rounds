import { describe, expect, it, vi } from "vitest";
import fixture from "@/test/fixtures/block-86837068.json";
import {
  TronRpcClient,
  blockTimestampSeconds,
  findBlockAtOrAfterSecond54,
  type EthBlock,
} from "@/lib/tron-rpc";

function makeRpc(blocks: Map<number, EthBlock>): TronRpcClient {
  const client = new TronRpcClient({ minIntervalMs: 0 });
  vi.spyOn(client, "getBlockByNumber").mockImplementation(async (n: number) => {
    return blocks.get(n) ?? null;
  });
  return client;
}

describe("blockTimestampSeconds", () => {
  it("parses hex seconds", () => {
    expect(blockTimestampSeconds(fixture as EthBlock)).toBe(parseInt(fixture.timestamp, 16));
  });
});

describe("findBlockAtOrAfterSecond54", () => {
  it("walks to first block at or after target", async () => {
    const target = parseInt(fixture.timestamp, 16);
    const bn = parseInt(fixture.number, 16);
    const blocks = new Map<number, EthBlock>();
    for (let i = bn - 3; i <= bn + 2; i++) {
      const ts = target - 3 * (bn - i);
      blocks.set(i, {
        number: `0x${i.toString(16)}`,
        hash: fixture.hash,
        timestamp: `0x${ts.toString(16)}`,
      });
    }
    const rpc = makeRpc(blocks);
    const found = await findBlockAtOrAfterSecond54(rpc, target, bn - 3);
    expect(found.blockNumber).toBe(bn);
    expect(blockTimestampSeconds(found.block)).toBeGreaterThanOrEqual(target);
  });
});

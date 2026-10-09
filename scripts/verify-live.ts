/**
 * Live TronGrid verification (run manually on VM, not in CI).
 * Usage: pnpm tsx scripts/verify-live.ts
 */
import fixture from "../src/test/fixtures/block-86837068.json";
import { deriveRoundOutcome } from "../src/lib/digit";
import { roundMetaFromUtcDate, targetTimestampSecond54, anchorDateForRound } from "../src/lib/round";
import {
  TronRpcClient,
  blockTimestampSeconds,
  findBlockAtOrAfterSecond54,
} from "../src/lib/tron-rpc";

async function main() {
  const rpc = new TronRpcClient({ minIntervalMs: 150 });
  const bn = parseInt(fixture.number, 16);
  const block = await rpc.getBlockByNumber(bn);
  if (!block) throw new Error("Fixture block missing");
  const outcome = deriveRoundOutcome(block.hash);
  console.log("Fixture block", bn, outcome, new Date(blockTimestampSeconds(block) * 1000).toISOString());

  const meta = roundMetaFromUtcDate(new Date("2026-10-05T07:04:00.000Z"));
  if (meta.roundId !== "202**0425") throw new Error("Round ID mismatch");

  const target = targetTimestampSecond54(anchorDateForRound(meta.utcDate, meta.roundNumber));
  const found = await findBlockAtOrAfterSecond54(rpc, target, bn - 20);
  console.log("Located :54 block", found.blockNumber, found.block.hash.slice(0, 18) + "…");

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

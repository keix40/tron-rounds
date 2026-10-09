import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/block-86837068.json";
import {
  deriveRoundOutcome,
  extractResultDigit,
  hashTail,
  digitToSide,
} from "@/lib/digit";

describe("extractResultDigit", () => {
  it("finds last decimal digit skipping a-f", () => {
    expect(extractResultDigit("0xabc123def456")).toBe(6);
    expect(extractResultDigit("0xabcdef")).toBeNull();
    expect(extractResultDigit("0xaaa9")).toBe(9);
  });
});

describe("block 86837068 fixture", () => {
  it("matches known round outcome", () => {
    const outcome = deriveRoundOutcome(fixture.hash);
    expect(outcome.resultDigit).toBe(3);
    expect(outcome.side).toBe("S");
    expect(outcome.parity).toBe("Odd");
    expect(outcome.hashTail).toBe("5a3b");
    expect(digitToSide(3)).toBe("S");
  });

  it("timestamp is :54 at 07:04 UTC", () => {
    const ts = parseInt(fixture.timestamp, 16);
    expect(new Date(ts * 1000).toISOString()).toBe("2026-10-05T07:04:54.000Z");
  });

  it("block number decodes to 86837068", () => {
    expect(parseInt(fixture.number, 16)).toBe(86837068);
  });
});

describe("hashTail", () => {
  it("returns last 4 hex chars", () => {
    expect(hashTail(fixture.hash)).toBe("5a3b");
  });
});

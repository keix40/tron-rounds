import { describe, expect, it } from "vitest";
import {
  anchorDateForRound,
  formatRoundId,
  latestCompletedRoundAnchor,
  roundMetaFromUtcDate,
  roundNumberFromUtc,
  targetTimestampSecond54,
  utcDateString,
} from "@/lib/round";

describe("round number and ID", () => {
  it("computes round 425 at 07:04 UTC", () => {
    const d = new Date("2026-10-05T07:04:00.000Z");
    expect(roundNumberFromUtc(d.getUTCHours(), d.getUTCMinutes())).toBe(425);
    expect(formatRoundId(425)).toBe("202**0425");
    expect(roundMetaFromUtcDate(d)).toMatchObject({
      utcDate: "2026-10-05",
      roundNumber: 425,
      roundId: "202**0425",
    });
  });

  it("resets at midnight UTC (round 1 at 00:00)", () => {
    const d = new Date("2026-10-06T00:00:00.000Z");
    expect(roundMetaFromUtcDate(d).roundNumber).toBe(1);
  });

  it("round 1440 at 23:59 UTC", () => {
    const d = new Date("2026-10-05T23:59:00.000Z");
    expect(roundMetaFromUtcDate(d).roundNumber).toBe(1440);
  });

  it("MMT midnight boundary maps to 06:30 UTC previous calendar day minute", () => {
    const mmtMidnight = new Date("2026-10-06T00:00:00.000+06:30");
    expect(mmtMidnight.toISOString()).toBe("2026-10-05T17:30:00.000Z");
    expect(roundMetaFromUtcDate(mmtMidnight).roundNumber).toBe(17 * 60 + 30 + 1);
  });

  it("target :54 second for minute anchor", () => {
    const anchor = anchorDateForRound("2026-10-05", 425);
    expect(targetTimestampSecond54(anchor)).toBe(
      Math.floor(new Date("2026-10-05T07:04:54.000Z").getTime() / 1000),
    );
  });
});

describe("latestCompletedRoundAnchor", () => {
  it("uses current minute when second >= 54", () => {
    const now = new Date("2026-10-05T07:10:55.000Z");
    const anchor = latestCompletedRoundAnchor(now);
    expect(anchor.toISOString()).toBe("2026-10-05T07:10:00.000Z");
  });

  it("uses previous minute when second < 54", () => {
    const now = new Date("2026-10-05T07:10:53.000Z");
    const anchor = latestCompletedRoundAnchor(now);
    expect(anchor.toISOString()).toBe("2026-10-05T07:09:00.000Z");
  });
});

describe("utcDateString", () => {
  it("uses UTC calendar date", () => {
    expect(utcDateString(new Date("2026-10-05T23:00:00.000Z"))).toBe("2026-10-05");
  });
});

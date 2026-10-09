import { describe, expect, it } from "vitest";
import { parseRoundsQuery, parseStatsQuery } from "@/lib/query-params";

describe("parseRoundsQuery", () => {
  it("defaults pagination and sort", () => {
    const q = parseRoundsQuery(new URLSearchParams());
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(50);
    expect(q.sort).toBe("blockTimeUtc");
    expect(q.order).toBe("desc");
  });

  it("parses filters", () => {
    const q = parseRoundsQuery(
      new URLSearchParams({
        side: "B",
        parity: "Even",
        digit: "8",
        sort: "roundId",
        order: "asc",
        page: "2",
        tz: "mmt",
      }),
    );
    expect(q).toMatchObject({
      side: "B",
      parity: "Even",
      digit: 8,
      sort: "roundId",
      order: "asc",
      page: 2,
      tz: "mmt",
    });
  });

  it("rejects invalid digit", () => {
    expect(() => parseRoundsQuery(new URLSearchParams({ digit: "12" }))).toThrow();
  });
});

describe("parseStatsQuery", () => {
  it("accepts filter fields only", () => {
    const q = parseStatsQuery(new URLSearchParams({ side: "S", dateFrom: "2026-10-01" }));
    expect(q.side).toBe("S");
    expect(q.dateFrom).toBe("2026-10-01");
  });
});

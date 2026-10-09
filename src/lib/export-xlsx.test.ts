import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Round } from "@/db/schema";
import { roundsToXlsxBuffer } from "@/lib/export-xlsx";

const sample: Round = {
  utcDate: "2026-10-05",
  roundNumber: 425,
  roundId: "202**0425",
  blockNumber: 86837068,
  blockHash: "0x00000000052d074cc62d9c76d6234c1a7b4cc5d96f0c9fc5fbb5806ecc545a3b",
  hashTail: "5a3b",
  resultDigit: 3,
  side: "S",
  parity: "Odd",
  blockTimeUtc: new Date("2026-10-05T07:04:54.000Z"),
  createdAt: new Date(),
};

describe("roundsToXlsxBuffer", () => {
  it("produces worksheet with expected headers and row", async () => {
    const buf = await roundsToXlsxBuffer([sample]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Rounds");
    expect(ws).toBeDefined();
    const header = ws!.getRow(1).values as unknown[];
    expect(header).toContain("Round ID");
    expect(header).toContain("Block Time MMT");
    const row = ws!.getRow(2).values as unknown[];
    expect(row).toContain("202**0425");
    expect(row).toContain(86837068);
    expect(row).toContain("S");
  });
});

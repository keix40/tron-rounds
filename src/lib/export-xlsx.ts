import ExcelJS from "exceljs";
import type { Round } from "@/db/schema";
import { formatMmt, formatUtc } from "@/lib/time";

export async function roundsToXlsxBuffer(rows: Round[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rounds");
  ws.columns = [
    { header: "Round ID", key: "roundId", width: 14 },
    { header: "UTC Date", key: "utcDate", width: 12 },
    { header: "Round #", key: "roundNumber", width: 10 },
    { header: "Block", key: "blockNumber", width: 12 },
    { header: "Block Hash", key: "blockHash", width: 68 },
    { header: "Hash Tail", key: "hashTail", width: 10 },
    { header: "Digit", key: "resultDigit", width: 8 },
    { header: "B/S", key: "side", width: 6 },
    { header: "Odd/Even", key: "parity", width: 10 },
    { header: "Block Time UTC", key: "blockTimeUtc", width: 24 },
    { header: "Block Time MMT", key: "blockTimeMmt", width: 24 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      roundId: r.roundId,
      utcDate: r.utcDate,
      roundNumber: r.roundNumber,
      blockNumber: r.blockNumber,
      blockHash: r.blockHash,
      hashTail: r.hashTail,
      resultDigit: r.resultDigit,
      side: r.side,
      parity: r.parity,
      blockTimeUtc: formatUtc(r.blockTimeUtc),
      blockTimeMmt: formatMmt(r.blockTimeUtc),
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return buf;
}

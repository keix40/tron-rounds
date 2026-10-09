import { z } from "zod";

const sortColumns = [
  "roundId",
  "blockNumber",
  "blockHash",
  "hashTail",
  "resultDigit",
  "side",
  "parity",
  "blockTimeUtc",
] as const;

export type SortColumn = (typeof sortColumns)[number];

export const roundsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.enum(sortColumns).default("blockTimeUtc"),
  order: z.enum(["asc", "desc"]).default("desc"),
  side: z.enum(["S", "B"]).optional(),
  parity: z.enum(["Odd", "Even"]).optional(),
  digit: z.coerce.number().int().min(0).max(9).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  tz: z.enum(["utc", "mmt"]).default("utc"),
});

export type RoundsQuery = z.infer<typeof roundsQuerySchema>;

export function parseRoundsQuery(searchParams: URLSearchParams): RoundsQuery {
  const raw = Object.fromEntries(searchParams.entries());
  return roundsQuerySchema.parse(raw);
}

/** Parse YYYY-MM-DD or ISO datetime; interpret calendar day in tz. */
export function parseFilterDate(value: string, tz: "utc" | "mmt", endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (tz === "utc") {
      return endOfDay
        ? new Date(`${value}T23:59:59.999Z`)
        : new Date(`${value}T00:00:00.000Z`);
    }
    const offset = "+06:30";
    return endOfDay
      ? new Date(`${value}T23:59:59.999${offset}`)
      : new Date(`${value}T00:00:00.000${offset}`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return d;
}

export const statsQuerySchema = roundsQuerySchema.pick({
  side: true,
  parity: true,
  digit: true,
  dateFrom: true,
  dateTo: true,
  tz: true,
});

export type StatsQuery = z.infer<typeof statsQuerySchema>;

export function parseStatsQuery(searchParams: URLSearchParams): StatsQuery {
  const raw = Object.fromEntries(searchParams.entries());
  return statsQuerySchema.parse(raw);
}

export const EXPORT_ROW_CAP = 50_000;

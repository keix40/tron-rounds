import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const rounds = pgTable(
  "rounds",
  {
    utcDate: text("utc_date").notNull(),
    roundNumber: integer("round_number").notNull(),
    roundId: text("round_id").notNull(),
    blockNumber: integer("block_number").notNull(),
    blockHash: text("block_hash").notNull(),
    hashTail: text("hash_tail").notNull(),
    resultDigit: integer("result_digit").notNull(),
    side: text("side").notNull(),
    parity: text("parity").notNull(),
    blockTimeUtc: timestamp("block_time_utc", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.utcDate, table.roundNumber] }),
    index("rounds_round_id_idx").on(table.roundId),
    uniqueIndex("rounds_block_number_idx").on(table.blockNumber),
    index("rounds_block_time_utc_idx").on(table.blockTimeUtc),
    index("rounds_side_idx").on(table.side),
    index("rounds_parity_idx").on(table.parity),
    index("rounds_result_digit_idx").on(table.resultDigit),
  ],
);

export type Round = typeof rounds.$inferSelect;
export type NewRound = typeof rounds.$inferInsert;

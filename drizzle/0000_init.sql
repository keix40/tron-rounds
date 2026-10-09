CREATE TABLE IF NOT EXISTS "rounds" (
  "utc_date" text NOT NULL,
  "round_number" integer NOT NULL,
  "round_id" text NOT NULL,
  "block_number" integer NOT NULL,
  "block_hash" text NOT NULL,
  "hash_tail" text NOT NULL,
  "result_digit" integer NOT NULL,
  "side" text NOT NULL,
  "parity" text NOT NULL,
  "block_time_utc" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "rounds_pkey" PRIMARY KEY ("utc_date", "round_number")
);

CREATE INDEX IF NOT EXISTS "rounds_round_id_idx" ON "rounds" ("round_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rounds_block_number_idx" ON "rounds" ("block_number");
CREATE INDEX IF NOT EXISTS "rounds_block_time_utc_idx" ON "rounds" ("block_time_utc");
CREATE INDEX IF NOT EXISTS "rounds_side_idx" ON "rounds" ("side");
CREATE INDEX IF NOT EXISTS "rounds_parity_idx" ON "rounds" ("parity");
CREATE INDEX IF NOT EXISTS "rounds_result_digit_idx" ON "rounds" ("result_digit");

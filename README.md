# TRON Rounds

Live archive and statistics for TRON mainnet **rounds** — the block whose timestamp falls on **:54** of each UTC minute. This replaces a Google Sheet that updated every five minutes.

**Archive and stats only.** There is no prediction, betting, pattern analysis, or “next result” functionality. Outcomes come from unpredictable block hashes.

**Live site:** _(add Vercel deployment URL after deploy)_

## Rules

| Concept | Rule |
|--------|------|
| Round block | TRON mainnet block with timestamp at second **:54** of each UTC minute. If none lands exactly on :54, use the **first block at or after** :54 (~3s block interval). |
| Round number | `UTC hour × 60 + UTC minute + 1` → **1–1440**, resets at **00:00 UTC** (06:30 MMT). |
| Round ID (display) | `202**` + 4-digit zero-padded round number, e.g. `202**0425`. |
| Primary key | `(utc_date, round_number)` where `utc_date` is `YYYY-MM-DD` UTC. |
| Result digit | Last decimal digit `0–9` in the block hash, scanning from the end and skipping `a–f`. |
| B / S | **S** if digit 0–4, **B** if 5–9. |
| Odd / Even | Parity of the result digit. |

**Known check:** Round `202**0425` on `2026-10-05` at `07:04:54 UTC` → block **86837068**, hash tail **5a3b**, digit **3**, **S**.

## Architecture

- **Next.js 15** (App Router, TypeScript strict) on **Vercel**
- **Postgres** (Neon) via `DATABASE_URL`
- **Drizzle** schema + plain SQL migrations in `drizzle/`
- **TronGrid** JSON-RPC: `https://api.trongrid.io/jsonrpc` (`eth_getBlockByNumber`, batch requests, `eth_blockNumber`)

### Freshness (no paid cron)

`syncRounds()` is **idempotent**: it fills missing rounds from the last stored row through the latest **completed** minute.

| Trigger | Behavior |
|---------|----------|
| `GET /api/rounds` | If data is stale, runs sync (max **30** rounds per request, throttled with Postgres **`pg_try_advisory_lock`**) |
| `POST /api/sync` | Bearer `SYNC_SECRET`; up to **120** rounds per call (GitHub Actions every **5** min) |
| `pnpm backfill --days N` | Initial import (~14 days ≈ 20k rounds) |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string (Neon) |
| `DATABASE_DRIVER` | No | Set to `neon` (or `serverless`) to use `@neondatabase/serverless` WebSocket driver (port 443) instead of `postgres` TCP |
| `USE_NEON_SERVERLESS` | No | Set to `1` — same as `DATABASE_DRIVER=neon` |
| `SYNC_SECRET` | Yes (prod) | Bearer token for `POST /api/sync` |
| `TRONGRID_API_KEY` | No | Optional TronGrid Pro API key header |
| `TRONGRID_RPC_URL` | No | Override JSON-RPC URL (default: public TronGrid) |

### GitHub Actions secrets (sync workflow)

| Secret | Example |
|--------|---------|
| `SYNC_URL` | `https://your-app.vercel.app/api/sync` |
| `SYNC_SECRET` | Same value as Vercel `SYNC_SECRET` |

## Local development

```bash
pnpm install
cp .env.example .env.local   # set DATABASE_URL
pnpm db:migrate
pnpm dev
```

### Backfill

```bash
pnpm backfill --days 14
```

Rate depends on TronGrid limits; the script logs approximate **rounds/minute**.

### Live verification (VM / manual)

```bash
pnpm tsx scripts/verify-live.ts
```

## API

### `GET /api/rounds`

Query parameters:

- `page`, `pageSize` (max 500)
- `sort`: `roundId`, `blockNumber`, `blockHash`, `hashTail`, `resultDigit`, `side`, `parity`, `blockTimeUtc`
- `order`: `asc` | `desc`
- Filters: `side`, `parity`, `digit`, `dateFrom`, `dateTo`, `tz` (`utc` | `mmt`)

Triggers stale sync when needed.

### `GET /api/stats`

Same filters as rounds (no pagination). Returns counts: total, B/S, odd/even, digit distribution **0–9**.

### `GET /api/export.xlsx`

Same filters; streams Excel (max **50,000** rows).

### `POST /api/sync`

Header: `Authorization: Bearer <SYNC_SECRET>`. Optional query `?max=120`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm db:migrate` | Apply SQL migrations |
| `pnpm backfill --days N` | Chain backfill |

## CI

GitHub Actions workflow **`ci`**: install, migrate (Postgres service), lint, typecheck, test, build.

## License

MIT — see [LICENSE](LICENSE).

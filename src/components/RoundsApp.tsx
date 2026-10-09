"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RoundRow = {
  roundId: string;
  blockNumber: number;
  blockHash: string;
  hashTail: string;
  resultDigit: number;
  side: string;
  parity: string;
  blockTimeUtcLabel: string;
  blockTimeMmtLabel: string;
};

type Stats = {
  total: number;
  bySide: { S: number; B: number };
  byParity: { Odd: number; Even: number };
  byDigit: Record<string, number>;
};

const SORT_COLUMNS = [
  "roundId",
  "blockNumber",
  "hashTail",
  "resultDigit",
  "side",
  "parity",
  "blockTimeUtc",
] as const;

type SortCol = (typeof SORT_COLUMNS)[number];

function buildQuery(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
}

function SideBadge({ side }: { side: string }) {
  const isS = side === "S";
  return (
    <span
      className={`inline-flex min-w-[2rem] justify-center rounded px-2 py-0.5 text-xs font-semibold ${
        isS ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
      }`}
    >
      {side}
    </span>
  );
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
  return (
    <button
      type="button"
      className="font-mono text-xs text-muted hover:text-foreground"
      title={hash}
      onClick={async () => {
        await navigator.clipboard.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : short}
    </button>
  );
}

export default function RoundsApp() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sort, setSort] = useState<SortCol>("blockTimeUtc");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [side, setSide] = useState("");
  const [parity, setParity] = useState("");
  const [digit, setDigit] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tz, setTz] = useState<"utc" | "mmt">("mmt");

  const [rows, setRows] = useState<RoundRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [meta, setMeta] = useState<{ lastUpdated: string | null; isStale: boolean; latestCompletedRoundId?: string } | null>(null);
  const [refreshHint, setRefreshHint] = useState("Auto-refresh ~20s");
  const metaRef = useRef(meta);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterQuery = useMemo(
    () =>
      buildQuery({
        page,
        pageSize,
        sort,
        order,
        side: side || undefined,
        parity: parity || undefined,
        digit: digit || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        tz,
      }),
    [page, pageSize, sort, order, side, parity, digit, dateFrom, dateTo, tz],
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet ?? false;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [roundsRes, statsRes] = await Promise.all([
        fetch(`/api/rounds?${filterQuery}`),
        fetch(`/api/stats?${buildQuery({ side: side || undefined, parity: parity || undefined, digit: digit || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, tz })}`),
      ]);
      if (!roundsRes.ok) throw new Error((await roundsRes.json()).error ?? "Failed to load rounds");
      if (!statsRes.ok) throw new Error((await statsRes.json()).error ?? "Failed to load stats");
      const roundsJson = await roundsRes.json();
      const statsJson = await statsRes.json();
      setRows(roundsJson.data);
      setTotalPages(roundsJson.pagination.totalPages || 1);
      setMeta(roundsJson.meta);
      setStats(statsJson);
      return roundsJson.meta as { lastUpdated: string | null; isStale: boolean; latestCompletedRoundId?: string };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [filterQuery, side, parity, digit, dateFrom, dateTo, tz]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [roundsRes, statsRes] = await Promise.all([
          fetch(`/api/rounds?${filterQuery}`),
          fetch(
            `/api/stats?${buildQuery({ side: side || undefined, parity: parity || undefined, digit: digit || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, tz })}`,
          ),
        ]);
        if (cancelled) return;
        if (!roundsRes.ok) throw new Error((await roundsRes.json()).error ?? "Failed to load rounds");
        if (!statsRes.ok) throw new Error((await statsRes.json()).error ?? "Failed to load stats");
        const roundsJson = await roundsRes.json();
        const statsJson = await statsRes.json();
        setRows(roundsJson.data);
        setTotalPages(roundsJson.pagination.totalPages || 1);
        setMeta(roundsJson.meta);
        setStats(statsJson);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filterQuery, side, parity, digit, dateFrom, dateTo, tz]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    function delayMs(isStale: boolean): number {
      const now = new Date();
      const sec = now.getUTCSeconds();
      const ms = now.getUTCMilliseconds();
      // Fast poll from :52 through :08 so the tip sync is warm when grace opens.
      if (isStale || sec >= 52 || sec <= 8) {
        setRefreshHint("Catching up… (1s)");
        return 1000;
      }
      // Wake at :52 so we never sleep through the new round.
      const msUntil54 = (52 - sec) * 1000 - ms;
      setRefreshHint("Auto-refresh ~20s");
      return Math.min(20_000, Math.max(200, msUntil54));
    }

    async function tick() {
      if (cancelled) return;
      const staleNow = Boolean(metaRef.current?.isStale);
      const wait = delayMs(staleNow);
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (!inFlight) {
          inFlight = true;
          try {
            await load({ quiet: true });
          } finally {
            inFlight = false;
          }
        }
        // If still catching up, retry ASAP instead of waiting another full delay.
        if (!cancelled && metaRef.current?.isStale) {
          timer = setTimeout(() => void tick(), 200);
          return;
        }
        void tick();
      }, wait);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  function toggleSort(col: SortCol) {
    if (sort === col) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(col);
      setOrder("desc");
    }
    setPage(1);
  }

  const exportUrl = `/api/export.xlsx?${buildQuery({ side: side || undefined, parity: parity || undefined, digit: digit || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, tz, sort: "blockTimeUtc", order: "asc" })}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">TRON Rounds Archive</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Historical :54 UTC block rounds — result digit, B/S, and odd/even. Archive and stats only; no
          predictions.
        </p>
        <p className="mt-2 text-xs text-muted">
          Last updated:{" "}
          {meta?.lastUpdated ? new Date(meta.lastUpdated).toLocaleString() : "—"}
          {meta?.isStale
            ? ` · Catching up${meta.latestCompletedRoundId ? ` to ${meta.latestCompletedRoundId}` : ""}…`
            : ""}
          {" · "}
          {refreshHint}
        </p>
      </header>

      {stats && (
        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total (filtered)" value={stats.total.toLocaleString()} />
          <StatCard label="S / B" value={`${stats.bySide.S} / ${stats.bySide.B}`} />
          <StatCard label="Odd / Even" value={`${stats.byParity.Odd} / ${stats.byParity.Even}`} />
          <StatCard
            label="Digits 0–9"
            value={Object.entries(stats.byDigit)
              .map(([d, c]) => `${d}:${c}`)
              .join(" ")}
            small
          />
        </section>
      )}

      <section className="mb-4 flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <FilterSelect label="B/S" value={side} onChange={(v) => { setSide(v); setPage(1); }} options={[["", "All"], ["S", "S"], ["B", "B"]]} />
        <FilterSelect label="Parity" value={parity} onChange={(v) => { setParity(v); setPage(1); }} options={[["", "All"], ["Odd", "Odd"], ["Even", "Even"]]} />
        <label className="flex flex-col gap-1 text-xs text-muted">
          Digit
          <input
            className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={digit}
            onChange={(e) => { setDigit(e.target.value); setPage(1); }}
            placeholder="0–9"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <input type="date" className="rounded border border-border bg-background px-2 py-1.5 text-sm" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          To
          <input type="date" className="rounded border border-border bg-background px-2 py-1.5 text-sm" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </label>
        <FilterSelect label="Dates in" value={tz} onChange={(v) => { setTz(v as "utc" | "mmt"); setPage(1); }} options={[["mmt", "MMT"], ["utc", "UTC"]]} />
        <a
          href={exportUrl}
          className="ml-auto self-end rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Export Excel
        </a>
      </section>

      {error && (
        <div className="mb-4 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-card text-xs uppercase text-muted">
            <tr>
              {(
                [
                  ["roundId", "Round ID"],
                  ["blockNumber", "Block"],
                  ["hash", "Hash"],
                  ["hashTail", "Tail"],
                  ["resultDigit", "Digit"],
                  ["side", "B/S"],
                  ["parity", "O/E"],
                  ["mmt", "MMT"],
                  ["utc", "UTC"],
                ] as const
              ).map(([key, label]) => (
                <th key={key} className="whitespace-nowrap px-3 py-3 font-medium">
                  {key === "blockNumber" || SORT_COLUMNS.includes(key as SortCol) ? (
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => toggleSort(key === "blockNumber" ? "blockNumber" : (key as SortCol))}
                    >
                      {label}
                      {sort === key || (key === "blockNumber" && sort === "blockNumber")
                        ? order === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.roundId}-${r.blockNumber}`} className="border-t border-border hover:bg-card/80">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.roundId}</td>
                  <td className="px-3 py-2">
                    <a
                      className="text-accent hover:underline"
                      href={`https://tronscan.org/#/block/${r.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r.blockNumber}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <CopyHash hash={r.blockHash} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.hashTail}</td>
                  <td className="px-3 py-2 font-mono">{r.resultDigit}</td>
                  <td className="px-3 py-2">
                    <SideBadge side={r.side} />
                  </td>
                  <td className="px-3 py-2 text-xs">{r.parity}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.blockTimeMmtLabel}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{r.blockTimeUtcLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 text-sm">
        <button
          type="button"
          disabled={page <= 1}
          className="rounded border border-border px-3 py-1.5 disabled:opacity-40"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span className="text-muted">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          className="rounded border border-border px-3 py-1.5 disabled:opacity-40"
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 font-semibold ${small ? "text-xs font-normal leading-relaxed" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

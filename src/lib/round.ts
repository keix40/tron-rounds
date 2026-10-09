/** UTC calendar date YYYY-MM-DD for a given instant. */
export function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Round number 1–1440 from UTC hour and minute. */
export function roundNumberFromUtc(hour: number, minute: number): number {
  return hour * 60 + minute + 1;
}

/** Display round ID e.g. 202**0425 */
export function formatRoundId(roundNumber: number): string {
  return `202**${String(roundNumber).padStart(4, "0")}`;
}

export function roundMetaFromUtcDate(d: Date): {
  utcDate: string;
  roundNumber: number;
  roundId: string;
} {
  const utcDate = utcDateString(d);
  const roundNumber = roundNumberFromUtc(d.getUTCHours(), d.getUTCMinutes());
  return {
    utcDate,
    roundNumber,
    roundId: formatRoundId(roundNumber),
  };
}

/** Target Unix second for the :54 mark of the minute containing `d` (UTC). */
export function targetTimestampSecond54(d: Date): number {
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return Math.floor(Date.UTC(y, mo, day, h, m, 54) / 1000);
}

/** Latest completed round minute: current UTC minute if second >= 54, else previous minute. */
export function latestCompletedRoundAnchor(now: Date = new Date()): Date {
  const anchor = new Date(now);
  anchor.setUTCSeconds(0, 0);
  if (now.getUTCSeconds() < 54) {
    anchor.setUTCMinutes(anchor.getUTCMinutes() - 1);
  }
  return anchor;
}

/** Previous round key relative to (utcDate, roundNumber). */
export function previousRoundKey(
  utcDate: string,
  roundNumber: number,
): { utcDate: string; roundNumber: number } {
  if (roundNumber > 1) {
    return { utcDate, roundNumber: roundNumber - 1 };
  }
  const prev = new Date(`${utcDate}T00:00:00.000Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return {
    utcDate: utcDateString(prev),
    roundNumber: 1440,
  };
}

/** Next round key after (utcDate, roundNumber). */
export function nextRoundKey(
  utcDate: string,
  roundNumber: number,
): { utcDate: string; roundNumber: number } {
  if (roundNumber < 1440) {
    return { utcDate, roundNumber: roundNumber + 1 };
  }
  const next = new Date(`${utcDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { utcDate: utcDateString(next), roundNumber: 1 };
}

/** All round keys from start (inclusive) through end (inclusive). */
export function enumerateRoundKeys(
  start: { utcDate: string; roundNumber: number },
  end: { utcDate: string; roundNumber: number },
): Array<{ utcDate: string; roundNumber: number }> {
  const out: Array<{ utcDate: string; roundNumber: number }> = [];
  let cur = { ...start };
  const endKey = `${end.utcDate}:${end.roundNumber}`;
  for (let guard = 0; guard < 50000; guard++) {
    out.push({ ...cur });
    const key = `${cur.utcDate}:${cur.roundNumber}`;
    if (key === endKey) break;
    cur = nextRoundKey(cur.utcDate, cur.roundNumber);
  }
  return out;
}

export function anchorDateForRound(utcDate: string, roundNumber: number): Date {
  const minuteOfDay = roundNumber - 1;
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return new Date(`${utcDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
}

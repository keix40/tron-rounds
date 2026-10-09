/** Normalize postgres-js RowList vs Neon QueryResult row access. */
export function firstRow<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) {
    return result[0] as T | undefined;
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: T[] }).rows;
    return rows[0];
  }
  return undefined;
}

export type Side = "S" | "B";
export type Parity = "Odd" | "Even";

/** Last decimal digit 0–9 in hash, scanning from the end and skipping a–f. */
export function extractResultDigit(blockHash: string): number | null {
  const normalized = blockHash.startsWith("0x") ? blockHash.slice(2) : blockHash;
  for (let i = normalized.length - 1; i >= 0; i--) {
    const c = normalized[i]!.toLowerCase();
    if (c >= "0" && c <= "9") {
      return Number(c);
    }
  }
  return null;
}

export function digitToSide(digit: number): Side {
  return digit <= 4 ? "S" : "B";
}

export function digitToParity(digit: number): Parity {
  return digit % 2 === 0 ? "Even" : "Odd";
}

export function hashTail(blockHash: string, len = 4): string {
  const normalized = blockHash.startsWith("0x") ? blockHash.slice(2) : blockHash;
  return normalized.slice(-len).toLowerCase();
}

export function deriveRoundOutcome(blockHash: string): {
  resultDigit: number;
  side: Side;
  parity: Parity;
  hashTail: string;
} {
  const resultDigit = extractResultDigit(blockHash);
  if (resultDigit === null) {
    throw new Error(`No decimal digit in block hash: ${blockHash}`);
  }
  return {
    resultDigit,
    side: digitToSide(resultDigit),
    parity: digitToParity(resultDigit),
    hashTail: hashTail(blockHash),
  };
}

import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** An error the agent can act on: shown to it as-is. */
export class LadderError extends Error {}

const SUFFIX: Record<string, string> = { k: "1e3", m: "1e6", b: "1e9", t: "1e12" };

/**
 * Accepts JSON numbers and shorthand strings like "1.1B", "750k", "1,400".
 * Strings that could be Indonesian thousands ("1.400") are refused rather than
 * guessed, because reading 1,400 as 1.4 would silently corrupt a position.
 */
export function parseAmount(value: string | number, label = "amount"): Decimal {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LadderError(`${label} is not a number`);
    return new Decimal(value);
  }
  const raw = value.trim().replace(/\s/g, "");
  const match = /^(.*?)([kmbt])?$/i.exec(raw);
  const suffix = match?.[2]?.toLowerCase();
  let body = match?.[1] ?? "";

  if (/^\d{1,3}(\.\d{3}){2,}$/.test(body)) {
    body = body.replace(/\./g, "");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) {
    body = body.replace(/,/g, "");
  } else if (!suffix && /^[1-9]\d{0,2}\.\d{3}$/.test(body)) {
    throw new LadderError(
      `${label} "${value}" is ambiguous: send it as a JSON number, or write 1400 or 1.4 without separators`,
    );
  }
  if (!/^\d*\.?\d+$/.test(body)) throw new LadderError(`${label} "${value}" is not a valid number`);

  const parsed = new Decimal(body);
  return suffix ? parsed.times(SUFFIX[suffix] as string) : parsed;
}

export function idr(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

export function qty(value: Decimal): string {
  return value.toDecimalPlaces(8).toString();
}

export function pct(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

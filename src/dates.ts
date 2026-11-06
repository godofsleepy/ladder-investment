import { LadderError } from "./money.js";

const JAKARTA = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });

export function today(): string {
  return JAKARTA.format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function assertDate(value: string, label = "date"): string {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!ok || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new LadderError(`${label} must be a real date in YYYY-MM-DD form, got "${value}"`);
  }
  return value;
}

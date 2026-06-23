import type { DailyRow } from "./csv";

export type DashboardPeriod = "7d" | "15d" | "30d" | "all" | "custom";

const SIGNAL_KEYS: Array<keyof DailyRow> = [
  "investimento",
  "impressoes",
  "cliques",
  "landingPageviews",
  "pageviews",
  "viewsUnicas",
  "playRate",
  "retPitch",
  "chegaramPitch",
  "checkouts",
  "vendasFront",
  "vendasTotais",
  "fatBruto",
  "fatLiquido",
  "fatFront",
  "fatOrderbump",
  "fatFunil",
  "reembolsos",
  "valorReembolsado",
];

export function hasDashboardSignal(row: DailyRow) {
  if (!row.date) return false;
  return SIGNAL_KEYS.some((key) => numericSignal(row[key]) > 0);
}

export function getDashboardPeriodRows(
  rows: DailyRow[],
  period: DashboardPeriod,
  customFrom = "",
  customTo = "",
) {
  const active = rows.filter(hasDashboardSignal);

  if (period === "all") {
    return { current: active, previous: [] as DailyRow[] };
  }

  if (period === "custom") {
    const cur = active.filter((row) => {
      const key = row.date ? localDateKey(row.date) : "";
      if (!key) return false;
      if (customFrom && key < customFrom) return false;
      if (customTo && key > customTo) return false;
      return true;
    });

    let previous: DailyRow[] = [];
    if (customFrom && customTo) {
      const spanDays = Math.max(1, daysBetween(customFrom, customTo) + 1);
      const prevTo = addDays(customFrom, -1);
      const prevFrom = addDays(prevTo, -(spanDays - 1));
      previous = active.filter((row) => {
        const key = row.date ? localDateKey(row.date) : "";
        return key >= prevFrom && key <= prevTo;
      });
    } else if (cur.length) {
      const firstIdx = active.findIndex((row) => row === cur[0]);
      previous = firstIdx > 0 ? active.slice(Math.max(0, firstIdx - cur.length), firstIdx) : [];
    }

    return { current: cur, previous };
  }

  const days = period === "7d" ? 7 : period === "15d" ? 15 : 30;
  return {
    current: active.slice(-days),
    previous: active.slice(Math.max(0, active.length - days * 2), active.length - days),
  };
}

export function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function numericSignal(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function daysBetween(from: string, to: string) {
  return Math.round((toUtcNoon(to).getTime() - toUtcNoon(from).getTime()) / 86_400_000);
}

function addDays(ymd: string, delta: number) {
  const date = toUtcNoon(ymd);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function toUtcNoon(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

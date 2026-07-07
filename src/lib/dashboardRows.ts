import type { DailyRow } from "./csv";

export type DashboardPeriod = "today" | "yesterday" | "7d" | "15d" | "30d" | "all" | "custom";

export interface DashboardDateRange {
  from: string | null;
  to: string | null;
}

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

  if (period === "today" || period === "yesterday") {
    const today = localDateKey(new Date());
    const target = period === "today" ? today : addDays(today, -1);
    const previousTarget = addDays(target, -1);
    return {
      current: active.filter((row) => row.date && localDateKey(row.date) === target),
      previous: active.filter((row) => row.date && localDateKey(row.date) === previousTarget),
    };
  }

  const days = period === "7d" ? 7 : period === "15d" ? 15 : 30;
  return {
    current: active.slice(-days),
    previous: active.slice(Math.max(0, active.length - days * 2), active.length - days),
  };
}

export function getDashboardSelectedDateRange(
  rows: DailyRow[],
  period: DashboardPeriod,
  customFrom = "",
  customTo = "",
): DashboardDateRange {
  const active = rows.filter(hasDashboardSignal);

  if (period === "custom") {
    const fallback = dateRangeForRows(active);
    const from = customFrom || customTo || fallback.from;
    const to = customTo || customFrom || fallback.to;
    if (from && to && from > to) return { from: to, to: from };
    return { from, to };
  }

  if (period === "today" || period === "yesterday") {
    const today = localDateKey(new Date());
    const target = period === "today" ? today : addDays(today, -1);
    return { from: target, to: target };
  }

  if (period === "all") {
    return dateRangeForRows(active);
  }

  const { current } = getDashboardPeriodRows(rows, period, customFrom, customTo);
  return dateRangeForRows(current);
}

export function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function numericSignal(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateRangeForRows(rows: DailyRow[]): DashboardDateRange {
  const keys = rows
    .map((row) => (row.date ? localDateKey(row.date) : ""))
    .filter(Boolean);
  if (keys.length === 0) return { from: null, to: null };
  return { from: keys[0], to: keys[keys.length - 1] };
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

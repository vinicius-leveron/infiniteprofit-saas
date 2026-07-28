export const HOTMART_BACKFILL_STATUSES = [
  "APPROVED",
  "COMPLETE",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
  "CANCELLED",
  "EXPIRED",
  "OVERDUE",
  "PROTESTED",
  "PRINTED_BILLET",
  "WAITING_PAYMENT",
] as const;

export function hotmartEventForStatus(status: unknown) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "APPROVED") return "PURCHASE_APPROVED";
  if (normalized === "COMPLETE") return "PURCHASE_COMPLETE";
  if (normalized === "REFUNDED") return "PURCHASE_REFUNDED";
  if (normalized === "PARTIALLY_REFUNDED") {
    return "PURCHASE_PARTIALLY_REFUNDED";
  }
  if (normalized === "CHARGEBACK") return "PURCHASE_CHARGEBACK";
  if (normalized === "CANCELLED") return "PURCHASE_CANCELED";
  if (normalized === "EXPIRED") return "PURCHASE_EXPIRED";
  if (normalized === "OVERDUE") return "PURCHASE_DELAYED";
  if (normalized === "PROTESTED") return "PURCHASE_PROTEST";
  if (normalized === "PRINTED_BILLET" || normalized === "WAITING_PAYMENT") {
    return "PURCHASE_BILLET_PRINTED";
  }
  return null;
}

export function boundedHotmartDateRange(args: {
  startDate?: unknown;
  endDate?: unknown;
  now?: Date;
  defaultDays?: number;
  maxDays?: number;
}) {
  const now = args.now ?? new Date();
  const maxDays = Math.max(1, Math.min(args.maxDays ?? 365, 365));
  const defaultDays = Math.max(
    1,
    Math.min(args.defaultDays ?? 90, maxDays),
  );
  const endDate = parseDate(args.endDate) ?? localYmd(now);
  const defaultStart = addDays(endDate, -(defaultDays - 1));
  const startDate = parseDate(args.startDate) ?? defaultStart;
  if (startDate > endDate) {
    throw new Error("A data inicial deve ser anterior à data final.");
  }
  const totalDays = dateDifference(startDate, endDate) + 1;
  if (totalDays > maxDays) {
    throw new Error(`O histórico Hotmart aceita no máximo ${maxDays} dias.`);
  }
  return { startDate, endDate, totalDays };
}

export function splitHotmartWindows(
  startDate: string,
  endDate: string,
  windowDays = 7,
) {
  const boundedWindow = Math.max(1, Math.min(Math.floor(windowDays), 7));
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const windowEnd = minDate(addDays(cursor, boundedWindow - 1), endDate);
    windows.push({ startDate: cursor, endDate: windowEnd });
    cursor = addDays(windowEnd, 1);
  }
  return windows;
}

export function hotmartRangeEpoch(startDate: string, endDate: string) {
  return {
    start: new Date(`${startDate}T00:00:00.000-03:00`).getTime(),
    end: new Date(`${endDate}T23:59:59.999-03:00`).getTime(),
  };
}

function parseDate(value: unknown) {
  const normalized = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function localYmd(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dateDifference(start: string, end: string) {
  const startMs = new Date(`${start}T12:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T12:00:00.000Z`).getTime();
  return Math.round((endMs - startMs) / 86_400_000);
}

function minDate(first: string, second: string) {
  return first < second ? first : second;
}

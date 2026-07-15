import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DashboardDateRange } from "@/lib/dashboardRows";
import { fBRL, fNum } from "@/lib/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  projectId?: string | null;
  dateRange?: DashboardDateRange;
}

type HeatmapEvent = {
  event_date: string;
  event_occurred_at: string | null;
  received_at: string;
  payload: unknown;
};

type Cell = {
  day: number;
  hour: number;
  sales: number;
  revenue: number;
};

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function SalesHeatmap({ projectId, dateRange }: Props) {
  const [events, setEvents] = useState<HeatmapEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      if (!projectId || !dateRange?.from || !dateRange.to) {
        setEvents([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      let result = await supabase
        .from("raw_events")
        .select("event_date, event_occurred_at, received_at, payload")
        .eq("project_id", projectId)
        .eq("event_type", "purchase.approved")
        .gte("event_date", dateRange.from)
        .lte("event_date", dateRange.to)
        .order("event_occurred_at", { ascending: true });

      // Compatibilidade temporária enquanto a migration nova ainda não chegou ao ambiente.
      if (result.error?.message.includes("event_occurred_at")) {
        const legacy = await supabase
          .from("raw_events")
          .select("event_date, received_at, payload")
          .eq("project_id", projectId)
          .eq("event_type", "purchase.approved")
          .gte("event_date", dateRange.from)
          .lte("event_date", dateRange.to)
          .order("received_at", { ascending: true });
        result = {
          ...legacy,
          data: legacy.data?.map((event) => ({ ...event, event_occurred_at: null })) ?? null,
        } as typeof result;
      }

      if (cancelled) return;
      if (result.error) {
        setEvents([]);
        setError("Não foi possível carregar os horários das vendas.");
      } else {
        setEvents((result.data ?? []) as HeatmapEvent[]);
      }
      setLoading(false);
    }

    void loadEvents();
    return () => {
      cancelled = true;
    };
  }, [dateRange?.from, dateRange?.to, projectId]);

  const { cells, maxSales } = useMemo(() => {
    const aggregate = new Map<string, Cell>();

    for (const event of events) {
      const timestamp = event.event_occurred_at ?? event.received_at;
      const hour = hourInSaoPaulo(timestamp);
      // The raw event date is the aggregation day and may have been written
      // in UTC.  Use the same timestamp/timezone as the hour so purchases
      // close to midnight are shown on the correct local weekday.
      const day = weekdayIndexInSaoPaulo(timestamp) ?? weekdayIndex(event.event_date);
      if (hour == null || day == null) continue;

      const key = `${day}:${hour}`;
      const current = aggregate.get(key) ?? { day, hour, sales: 0, revenue: 0 };
      current.sales += 1;
      current.revenue += eventRevenue(event.payload);
      aggregate.set(key, current);
    }

    const grid = DAYS.flatMap((_, day) =>
      HOURS.map((hour) => aggregate.get(`${day}:${hour}`) ?? { day, hour, sales: 0, revenue: 0 }),
    );

    return {
      cells: grid,
      maxSales: Math.max(0, ...grid.map((cell) => cell.sales)),
    };
  }, [events]);

  if (loading) {
    return (
      <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando horários das vendas…
      </div>
    );
  }

  if (!projectId || !dateRange?.from || !dateRange.to) {
    return <EmptyState message="Selecione uma operação e um período com dados para visualizar o mapa." />;
  }

  if (error) return <EmptyState message={error} />;
  if (events.length === 0) {
    return <EmptyState message="Ainda não há vendas com horário identificado neste período." />;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[780px]">
        <div className="mb-2 grid grid-cols-[56px_repeat(24,minmax(22px,1fr))] gap-1">
          <span />
          {HOURS.map((hour) => (
            <span key={hour} className="text-center text-[10px] tabular-nums text-muted-foreground">
              {hour.toString().padStart(2, "0")}
            </span>
          ))}
        </div>

        <div className="space-y-1">
          {DAYS.map((label, day) => (
            <div key={label} className="grid grid-cols-[56px_repeat(24,minmax(22px,1fr))] gap-1">
              <span className="flex items-center text-xs font-medium text-muted-foreground">{label}</span>
              {cells
                .filter((cell) => cell.day === day)
                .map((cell) => (
                  <HeatCell key={`${cell.day}:${cell.hour}`} cell={cell} maxSales={maxSales} dayLabel={label} />
                ))}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
          <span>Menos vendas</span>
          {[0, 0.2, 0.4, 0.65, 1].map((intensity) => (
            <span
              key={intensity}
              className="h-3 w-5 rounded-sm border border-border/40"
              style={{ backgroundColor: heatColor(intensity) }}
            />
          ))}
          <span>Mais vendas</span>
        </div>
      </div>
    </div>
  );
}

function HeatCell({ cell, maxSales, dayLabel }: { cell: Cell; maxSales: number; dayLabel: string }) {
  const intensity = maxSales > 0 ? cell.sales / maxSales : 0;
  const label = `${dayLabel}, ${cell.hour.toString().padStart(2, "0")}:00 — ${fNum(cell.sales)} venda${cell.sales === 1 ? "" : "s"}, ${fBRL(cell.revenue)}`;

  return (
    <Tooltip delayDuration={80}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "h-7 rounded-[4px] border border-border/35 outline-none transition-transform hover:scale-110 hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring",
            cell.sales === 0 && "bg-muted/35",
          )}
          style={cell.sales > 0 ? { backgroundColor: heatColor(intensity) } : undefined}
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-semibold">{dayLabel}, {cell.hour.toString().padStart(2, "0")}:00</div>
        <div>{fNum(cell.sales)} venda{cell.sales === 1 ? "" : "s"}</div>
        <div>{fBRL(cell.revenue)} em faturamento</div>
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-border/70 px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function heatColor(intensity: number) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const alpha = 0.16 + clamped * 0.78;
  return `hsl(var(--kpi-orange) / ${alpha.toFixed(2)})`;
}

function hourInSaoPaulo(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const parsed = Number(hour);
  return Number.isFinite(parsed) ? parsed : null;
}

function weekdayIndex(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const utcDay = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return (utcDay + 6) % 7;
}

function weekdayIndexInSaoPaulo(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(date).toLowerCase();
  const index: Record<string, number> = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
  };
  return index[day] ?? null;
}

function eventRevenue(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const value = (payload as Record<string, unknown>).net ?? (payload as Record<string, unknown>).total;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

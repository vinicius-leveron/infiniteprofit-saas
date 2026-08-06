import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DashboardDateRange } from "@/lib/dashboardRows";
import type { DashboardFilterState } from "@/lib/dashboardFilters";
import { fBRL, fNum } from "@/lib/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  projectId?: string | null;
  dateRange?: DashboardDateRange;
  mediaFilters?: DashboardFilterState;
}

type HeatmapRow = {
  weekday: number;
  hour: number;
  sales: number;
  revenue: number;
};

type Cell = {
  day: number;
  hour: number;
  sales: number;
  revenue: number;
};

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function SalesHeatmap({ projectId, dateRange, mediaFilters }: Props) {
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHeatmap() {
      if (!projectId || !dateRange?.from || !dateRange.to) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await supabase.rpc(
        "get_dashboard_sales_heatmap_v2",
        {
          _project_id: projectId,
          _from: dateRange.from,
          _to: dateRange.to,
          _account_ids: mediaFilters?.accountIds ?? [],
          _campaign_ids: mediaFilters?.campaignIds ?? [],
          _adset_ids: mediaFilters?.adsetIds ?? [],
          _include_unattributed: mediaFilters?.includeUnattributed ?? false,
        },
      );

      if (cancelled) return;
      if (result.error) {
        setRows([]);
        setError("Não foi possível carregar os horários das vendas.");
      } else {
        setRows((result.data ?? []) satisfies HeatmapRow[]);
      }
      setLoading(false);
    }

    void loadHeatmap();
    return () => {
      cancelled = true;
    };
  }, [
    dateRange?.from,
    dateRange?.to,
    mediaFilters?.accountIds,
    mediaFilters?.adsetIds,
    mediaFilters?.campaignIds,
    mediaFilters?.includeUnattributed,
    projectId,
  ]);

  const { cells, maxSales } = useMemo(() => {
    const aggregate = new Map<string, Cell>();

    for (const row of rows) {
      const day = Number(row.weekday);
      const hour = Number(row.hour);
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;

      const key = `${day}:${hour}`;
      const current = aggregate.get(key) ?? { day, hour, sales: 0, revenue: 0 };
      current.sales += Number(row.sales ?? 0);
      current.revenue += Number(row.revenue ?? 0);
      aggregate.set(key, current);
    }

    const grid = DAYS.flatMap((_, day) =>
      HOURS.map((hour) => aggregate.get(`${day}:${hour}`) ?? { day, hour, sales: 0, revenue: 0 }),
    );

    return {
      cells: grid,
      maxSales: Math.max(0, ...grid.map((cell) => cell.sales)),
    };
  }, [rows]);

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
  if (rows.length === 0) {
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

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export type Period =
  | "today"
  | "yesterday"
  | "7d"
  | "15d"
  | "this_month"
  | "last_month"
  | "all"
  | "custom";

interface Props {
  period: Period;
  customFrom: string;
  customTo: string;
  onPeriodChange: (p: Period) => void;
  onCustomChange: (from: string, to: string) => void;
  showLabel?: boolean;
}

const PRESETS: { id: Period; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "7d", label: "7 dias" },
  { id: "15d", label: "15 dias" },
  { id: "this_month", label: "Este mês" },
  { id: "last_month", label: "Mês passado" },
  { id: "all", label: "Tudo" },
];

const toIso = (d: Date) => format(d, "yyyy-MM-dd");

export const PeriodFilter = ({
  period,
  customFrom,
  customTo,
  onPeriodChange,
  onCustomChange,
  showLabel = true,
}: Props) => {
  const [open, setOpen] = useState(false);

  const range: DateRange | undefined =
    customFrom || customTo
      ? {
          from: customFrom ? new Date(customFrom + "T00:00:00") : undefined,
          to: customTo ? new Date(customTo + "T00:00:00") : undefined,
        }
      : undefined;

  const handleRangeSelect = (r: DateRange | undefined) => {
    if (!r) {
      onCustomChange("", "");
      return;
    }
    onCustomChange(r.from ? toIso(r.from) : "", r.to ? toIso(r.to) : "");
  };

  const customLabel =
    range?.from && range?.to
      ? `${format(range.from, "dd/MM", { locale: ptBR })} → ${format(range.to, "dd/MM", { locale: ptBR })}`
      : range?.from
      ? `A partir de ${format(range.from, "dd/MM", { locale: ptBR })}`
      : "Personalizado";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showLabel && (
        <div className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>Período:</span>
        </div>
      )}
      <div className="max-w-full overflow-x-auto">
        <div className="inline-flex min-w-max bg-secondary/60 rounded-lg p-1 gap-1">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => onPeriodChange(p.id)}
              className={cn(
                "min-h-11 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                period === p.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={period === "custom" ? "default" : "outline"}
            size="sm"
            className="min-h-11 gap-2 text-xs font-medium"
            aria-label={`Período personalizado: ${customLabel}`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            {period === "custom" ? customLabel : "Personalizado"}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleRangeSelect}
            numberOfMonths={1}
            locale={ptBR}
            className={cn("p-3 pointer-events-auto")}
          />
          <div className="flex justify-end gap-2 p-3 border-t border-border/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onCustomChange("", "");
                onPeriodChange("all");
                setOpen(false);
              }}
            >
              Limpar
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Aplicar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

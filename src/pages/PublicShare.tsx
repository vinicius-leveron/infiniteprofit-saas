import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, BarChart3, Clock, Download, LinkIcon, Loader2 } from "lucide-react";
import { OverviewPanel } from "@/components/OverviewPanel";
import { AttributionPanel } from "@/components/AttributionPanel";
import { ExecutiveReportPanel } from "@/components/ExecutiveReportPanel";
import { PeriodFilter, type Period } from "@/components/PeriodFilter";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { dailyMetricsToDailyRows, type DailyMetricsRow } from "@/lib/dailyMetrics";
import { exportElementToPdf } from "@/lib/exportPdf";
import type { DailyRow } from "@/lib/csv";

interface PublicProject {
  id: string;
  name: string;
  source: string;
  updated_at: string;
}

function getErrorInfo(error: string): { title: string; description: string; icon: React.ReactNode } {
  const errorLower = error.toLowerCase();

  if (errorLower.includes("desativado") || errorLower.includes("disabled")) {
    return {
      title: "Link desativado",
      description: "O proprietario desativou este link de compartilhamento.",
      icon: <LinkIcon className="w-10 h-10 mx-auto text-muted-foreground" />,
    };
  }
  if (errorLower.includes("expirado") || errorLower.includes("expired")) {
    return {
      title: "Link expirado",
      description: "Este link nao e mais valido. Solicite um novo ao proprietario.",
      icon: <Clock className="w-10 h-10 mx-auto text-muted-foreground" />,
    };
  }
  if (errorLower.includes("token") || errorLower.includes("invalido") || errorLower.includes("not found") || errorLower.includes("nao encontrado")) {
    return {
      title: "Link invalido",
      description: "Este link nao existe ou esta incorreto. Verifique a URL.",
      icon: <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />,
    };
  }
  return {
    title: "Link indisponivel",
    description: error,
    icon: <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />,
  };
}

export default function PublicShare() {
  const { token } = useParams();
  const reportRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<PublicProject | null>(null);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [period, setPeriod] = useState<Period>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    void supabase.functions.invoke("public-share", { body: { token } }).then(({ data, error: invokeError }) => {
      if (invokeError || data?.error) {
        setError(data?.error ?? invokeError?.message ?? "Link indisponível");
        setLoading(false);
        return;
      }
      setProject(data.project as PublicProject);
      setRows(dailyMetricsToDailyRows((data.metrics ?? []) as DailyMetricsRow[]));
      setLoading(false);
    });
  }, [token]);

  const { current, previous } = useMemo(() => {
    const active = rows.filter((row) => row.date && ((row.investimento ?? 0) > 0 || (row.vendasTotais ?? 0) > 0 || (row.fatLiquido ?? 0) > 0));
    if (period === "all") return { current: active, previous: [] as DailyRow[] };
    if (period === "custom") {
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo) : null;
      const cur = active.filter((row) => {
        if (!row.date) return false;
        if (from && row.date < from) return false;
        if (to && row.date > to) return false;
        return true;
      });
      return { current: cur, previous: [] as DailyRow[] };
    }
    const n = period === "7d" ? 7 : period === "15d" ? 15 : 30;
    return {
      current: active.slice(-n),
      previous: active.slice(Math.max(0, active.length - n * 2), active.length - n),
    };
  }, [rows, period, customFrom, customTo]);

  async function exportPdf() {
    if (!reportRef.current) return;
    const safeName = (project?.name || "dashboard").replace(/[^\w-]+/g, "_");
    await exportElementToPdf(reportRef.current, `${safeName}_public_${format(new Date(), "yyyy-MM-dd")}.pdf`);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (error) {
    const info = getErrorInfo(error);
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="section-card max-w-md text-center py-12">
          <div className="mb-4">{info.icon}</div>
          <h1 className="text-lg font-semibold mb-2">{info.title}</h1>
          <p className="text-sm text-muted-foreground mb-4">{info.description}</p>
          <p className="text-xs text-muted-foreground">
            Se acredita que isso e um erro, entre em contato com o proprietario do projeto.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/90 backdrop-blur-md border-b border-border/60">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow shrink-0">
              <BarChart3 className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-extrabold gradient-text-brand leading-none truncate">
                {project?.name}
              </h1>
              <p className="text-[11px] text-muted-foreground mt-1">Modo cliente · somente leitura</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
            <Download className="w-4 h-4" />
            PDF
          </Button>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="mb-6">
          <PeriodFilter
            period={period}
            customFrom={customFrom}
            customTo={customTo}
            onPeriodChange={(next) => {
              setPeriod(next);
              if (next !== "custom") {
                setCustomFrom("");
                setCustomTo("");
              }
            }}
            onCustomChange={(from, to) => {
              setCustomFrom(from);
              setCustomTo(to);
              if (from || to) setPeriod("custom");
            }}
          />
        </div>

        {current.length === 0 ? (
          <div className="section-card text-center py-16">
            <h2 className="font-semibold mb-1">Sem dados no período</h2>
            <p className="text-sm text-muted-foreground">A operação ainda não tem métricas agregadas para este filtro.</p>
          </div>
        ) : (
          <div ref={reportRef} className="space-y-6">
            <OverviewPanel rows={current} previous={previous} />
            <AttributionPanel rows={current} projectId={project?.id} />
            <ExecutiveReportPanel current={current} previous={previous} />
          </div>
        )}
      </div>
    </main>
  );
}

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fBRL, fNum, fPct, fMult } from "@/lib/metrics";
import type { DailyRow } from "@/lib/csv";
import {
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Activity,
  Target,
  Wallet,
  Eye,
  MousePointerClick,
  FileText,
  ShoppingBag,
  Play,
  Film,
  Pencil,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  row: DailyRow | null;
  onOpenChange: (o: boolean) => void;
  /** Quando definidos, habilita edição da observação direto no banco */
  projectId?: string | null;
  editable?: boolean;
  /** Callback após salvar — pai pode dar refresh nas linhas */
  onObsSaved?: (date: Date, obs: string) => void;
}

interface Stat {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  tone: "green" | "blue" | "violet" | "orange" | "red" | "cyan" | "indigo" | "emerald";
  hint?: string;
}

const toneClasses: Record<Stat["tone"], string> = {
  green: "text-kpi-green bg-kpi-green/10",
  blue: "text-kpi-blue bg-kpi-blue/10",
  violet: "text-kpi-violet bg-kpi-violet/10",
  orange: "text-kpi-orange bg-kpi-orange/10",
  red: "text-kpi-red bg-kpi-red/10",
  cyan: "text-kpi-cyan bg-kpi-cyan/10",
  indigo: "text-kpi-indigo bg-kpi-indigo/10",
  emerald: "text-kpi-emerald bg-kpi-emerald/10",
};

const toneText: Record<Stat["tone"], string> = {
  green: "text-kpi-green",
  blue: "text-kpi-blue",
  violet: "text-kpi-violet",
  orange: "text-kpi-orange",
  red: "text-kpi-red",
  cyan: "text-kpi-cyan",
  indigo: "text-kpi-indigo",
  emerald: "text-kpi-emerald",
};

export const DayDrilldownDialog = ({ row, onOpenChange, projectId, editable, onObsSaved }: Props) => {
  const [editingObs, setEditingObs] = useState(false);
  const [obsDraft, setObsDraft] = useState("");
  const [savingObs, setSavingObs] = useState(false);

  // Reset edição ao trocar de dia / fechar
  useEffect(() => {
    setEditingObs(false);
    setObsDraft(row?.obs ?? "");
  }, [row?.date?.getTime()]);

  if (!row) return null;
  const dateStr = row.date
    ? format(row.date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
    : row.data;

  const isoDate = row.date ? ymd(row.date) : null;
  const canEdit = !!editable && !!projectId && !!isoDate;

  async function saveObs() {
    if (!projectId || !isoDate) return;
    setSavingObs(true);
    try {
      const { error } = await supabase
        .from("daily_metrics")
        .update({ obs: obsDraft })
        .eq("project_id", projectId)
        .eq("event_date", isoDate);
      if (error) throw error;
      toast.success("Observação salva");
      setEditingObs(false);
      onObsSaved?.(row.date!, obsDraft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingObs(false);
    }
  }
  const weekday = row.diaSemana
    ? row.diaSemana.charAt(0).toUpperCase() + row.diaSemana.slice(1)
    : "";

  const financial: Stat[] = [
    {
      label: "Faturamento Líquido",
      value: fBRL(row.fatLiquido),
      icon: DollarSign,
      tone: "emerald",
      hint: `Bruto: ${fBRL(row.fatBruto)}`,
    },
    {
      label: "Lucro",
      value: fBRL(row.lucro),
      icon: TrendingUp,
      tone: row.lucro != null && row.lucro >= 0 ? "green" : "red",
    },
    {
      label: "ROI",
      value: fMult(row.roi),
      icon: Activity,
      tone: row.roi != null && row.roi >= 1 ? "green" : "red",
      hint: row.roi != null ? (row.roi >= 1 ? "Acima break-even" : "Abaixo break-even") : undefined,
    },
    {
      label: "Investimento",
      value: fBRL(row.investimento),
      icon: Wallet,
      tone: "orange",
    },
    {
      label: "Imposto Meta",
      value: fBRL(row.impostoMeta),
      icon: FileText,
      tone: "red",
      hint: "12,15% do investimento",
    },
  ];

  const sales: Stat[] = [
    {
      label: "Vendas Totais",
      value: fNum(row.vendasTotais),
      icon: ShoppingCart,
      tone: "blue",
      hint: `Front: ${fNum(row.vendasFront)}`,
    },
    {
      label: "AOV",
      value: fBRL(row.aov),
      icon: Target,
      tone: "violet",
    },
    {
      label: "CAC",
      value: fBRL(row.cac),
      icon: Target,
      tone: "indigo",
    },
    {
      label: "Reembolsos",
      value: fNum(row.reembolsos),
      icon: ShoppingBag,
      tone: "red",
      hint: `Taxa: ${fPct(row.taxaReembolso)}`,
    },
  ];

  const traffic: Stat[] = [
    { label: "Impressões", value: fNum(row.impressoes), icon: Eye, tone: "cyan" },
    { label: "Cliques no link", value: fNum(row.cliques), icon: MousePointerClick, tone: "blue" },
    { label: "LP Views", value: fNum(row.landingPageviews), icon: FileText, tone: "indigo" },
    { label: "Checkouts", value: fNum(row.checkouts), icon: ShoppingBag, tone: "violet" },
    { label: "CPM", value: fBRL(row.cpm), icon: Activity, tone: "orange" },
    { label: "CTR", value: fPct(row.ctr, 2), icon: Activity, tone: "emerald" },
    { label: "CPC", value: fBRL(row.cpc), icon: Activity, tone: "orange" },
    { label: "Taxa Carregamento", value: fPct(row.taxaCarreg), icon: Activity, tone: "emerald" },
  ];

  const funnel: Stat[] = [
    { label: "Pageviews VSL", value: fNum(row.pageviews), icon: FileText, tone: "indigo" },
    { label: "Play Rate", value: fPct(row.playRate), icon: Play, tone: "cyan" },
    { label: "Retenção Pitch", value: fPct(row.retPitch), icon: Film, tone: "blue" },
    { label: "Pitch → Checkout", value: fPct(row.pitchChk), icon: Activity, tone: "indigo" },
    { label: "Pitch → Venda", value: fPct(row.pitchVenda), icon: Activity, tone: "violet" },
    { label: "Checkout → Venda", value: fPct(row.chkVenda), icon: Activity, tone: "green" },
  ];

  const bumpsActive = (row.bumps ?? []).filter((b) => (b.count ?? 0) > 0 || (b.revenue ?? 0) > 0);

  const renderGrid = (stats: Stat[]) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border/60 bg-card/60 p-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">
              {s.label}
            </span>
            <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0", toneClasses[s.tone])}>
              <s.icon className="w-3 h-3" strokeWidth={2.4} />
            </div>
          </div>
          <div className={cn("text-base font-bold tabular-nums leading-none", toneText[s.tone])}>
            {s.value}
          </div>
          {s.hint && <div className="text-[10px] text-muted-foreground mt-1">{s.hint}</div>}
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-brand flex items-center justify-center shadow-glow">
              <DollarSign className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div>{dateStr}</div>
              {weekday && (
                <div className="text-xs font-normal text-muted-foreground mt-0.5">{weekday}</div>
              )}
            </div>
          </DialogTitle>
          <DialogDescription>Todas as métricas registradas neste dia</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
              Financeiro
            </h4>
            {renderGrid(financial)}
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
              Vendas
            </h4>
            {renderGrid(sales)}
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
              Tráfego
            </h4>
            {renderGrid(traffic)}
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
              Funil VSL
            </h4>
            {renderGrid(funnel)}
          </section>

          {bumpsActive.length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
                Bumps & Upsells
              </h4>
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Produto</th>
                      <th className="py-2 px-3 font-medium">Tipo</th>
                      <th className="py-2 px-3 font-medium text-right">Vendas</th>
                      <th className="py-2 px-3 font-medium text-right">Receita</th>
                      <th className="py-2 px-3 font-medium text-right">Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bumpsActive.map((b) => (
                      <tr key={b.name} className="border-t border-border/40">
                        <td className="py-2 px-3 font-medium text-foreground">{b.name}</td>
                        <td className="py-2 px-3">
                          <span
                            className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                              b.type === "upsell"
                                ? "bg-kpi-violet/15 text-kpi-violet"
                                : "bg-kpi-emerald/15 text-kpi-emerald",
                            )}
                          >
                            {b.type === "upsell" ? "Upsell" : "Bump"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{fNum(b.count)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium">
                          {fBRL(b.revenue)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{fPct(b.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(row.obs && row.obs.trim()) || canEdit ? (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Observações
                </h4>
                {canEdit && !editingObs && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      setObsDraft(row.obs ?? "");
                      setEditingObs(true);
                    }}
                  >
                    <Pencil className="w-3 h-3" />
                    {row.obs && row.obs.trim() ? "Editar" : "Adicionar"}
                  </Button>
                )}
              </div>
              {editingObs ? (
                <div className="space-y-2">
                  <Textarea
                    value={obsDraft}
                    onChange={(e) => setObsDraft(e.target.value)}
                    placeholder="Anote o que aconteceu nesse dia (lançamento, mudança de criativo, queda na entrega...)"
                    rows={4}
                    className="text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        setObsDraft(row.obs ?? "");
                        setEditingObs(false);
                      }}
                      disabled={savingObs}
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={saveObs}
                      disabled={savingObs}
                    >
                      {savingObs ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : row.obs && row.obs.trim() ? (
                <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm text-foreground whitespace-pre-line">
                  {row.obs}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/40 bg-card/30 p-3 text-xs text-muted-foreground italic">
                  Sem observações para este dia.
                </div>
              )}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

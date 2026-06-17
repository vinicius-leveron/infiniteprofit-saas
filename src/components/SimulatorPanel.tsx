import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Sliders, RotateCcw, Wand2, ArrowRight, TrendingUp, TrendingDown,
  Save, History, Trash2, Loader2, Play,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fBRL, fNum, fPct, fMult, computeTotals } from "@/lib/metrics";
import type { DailyRow } from "@/lib/csv";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";

interface Props {
  rows: DailyRow[];
}

interface SavedSimulation {
  id: string;
  name: string | null;
  inputs: SimInputs;
  result: SimResult;
  created_at: string;
}

interface SimInputs {
  // Tickets (R$ por venda)
  ticketFront: number;
  ticketBump: number;
  ticketUpsell: number;
  // Take-rate (% das vendas front que aceitam)
  takeRateBump: number;
  takeRateUpsell: number;
  // Aquisição
  impressoes: number;
  investimento: number;
  // Taxas do funil (em %)
  ctr: number;       // cliques / impressões
  connectRate: number; // LP Views / cliques no link
  playRate: number;    // plays / pageviews VSL
  pitchRet: number;    // chega ao pitch / plays
  pitchChk: number;    // chega ao checkout / pitch
  chkVenda: number;    // venda / checkout
}

interface SimResult {
  cliques: number;
  pageviews: number;
  plays: number;
  pitches: number;
  checkouts: number;
  vendasFront: number;
  vendasBump: number;
  vendasUpsell: number;
  vendasTotais: number;
  fatFront: number;
  fatBump: number;
  fatUpsell: number;
  fatLiquido: number;
  lucro: number;
  roi: number | null;
  cac: number | null;
  aov: number | null;
  cpm: number | null;
}

interface SensitivityPoint {
  delta: string;
  value: number;
  lucro: number;
  fat: number;
  lucroDelta: number;
  fatDelta: number;
}

const num = (v: number | null | undefined, fallback = 0) =>
  v == null || isNaN(v) || !isFinite(v) ? fallback : v;

function runSim(i: SimInputs): SimResult {
  const cliques = i.impressoes * (i.ctr / 100);
  const pageviews = cliques * (i.connectRate / 100);
  const plays = pageviews * (i.playRate / 100);
  const pitches = plays * (i.pitchRet / 100);
  const checkouts = pitches * (i.pitchChk / 100);
  const vendasFront = checkouts * (i.chkVenda / 100);
  const vendasBump = vendasFront * (i.takeRateBump / 100);
  const vendasUpsell = vendasFront * (i.takeRateUpsell / 100);
  const vendasTotais = vendasFront + vendasBump + vendasUpsell;
  const fatFront = vendasFront * i.ticketFront;
  const fatBump = vendasBump * i.ticketBump;
  const fatUpsell = vendasUpsell * i.ticketUpsell;
  const fatLiquido = fatFront + fatBump + fatUpsell;
  const lucro = fatLiquido - i.investimento;
  return {
    cliques, pageviews, plays, pitches, checkouts,
    vendasFront, vendasBump, vendasUpsell, vendasTotais,
    fatFront, fatBump, fatUpsell, fatLiquido, lucro,
    roi: i.investimento ? fatLiquido / i.investimento : null,
    cac: vendasTotais ? i.investimento / vendasTotais : null,
    aov: vendasFront ? fatLiquido / vendasFront : null,
    cpm: i.impressoes ? (i.investimento / i.impressoes) * 1000 : null,
  };
}

export const SimulatorPanel = ({ rows }: Props) => {
  const totals = useMemo(() => computeTotals(rows), [rows]);
  const { currentWorkspace } = useWorkspace();

  // Valores inferidos do CSV (médias do período)
  const baselineInputs = useMemo<SimInputs>(() => {
    const ticketFront = totals.vendasFront ? totals.fatFront / totals.vendasFront : 0;
    const vendasBumpInferred = Math.max(0, totals.vendasTotais - totals.vendasFront);
    const ticketBump = vendasBumpInferred ? totals.fatOrderbump / vendasBumpInferred : 0;
    const ticketUpsell = vendasBumpInferred ? (totals.fatFunil - totals.fatFront - totals.fatOrderbump) / vendasBumpInferred : 0;
    const takeRateBump = totals.vendasFront && totals.fatOrderbump
      ? Math.min(100, (vendasBumpInferred / totals.vendasFront) * 100)
      : 0;
    return {
      ticketFront: Math.round(ticketFront * 100) / 100,
      ticketBump: Math.round(ticketBump * 100) / 100,
      ticketUpsell: Math.max(0, Math.round(ticketUpsell * 100) / 100),
      takeRateBump: Math.round(takeRateBump * 10) / 10,
      takeRateUpsell: 0,
      impressoes: Math.round(totals.impressoes),
      investimento: Math.round(totals.investimento),
      ctr: num(totals.ctr, 1),
      connectRate: num(totals.taxaCarreg, 80),
      playRate: num(totals.avgPlayRate, 40),
      pitchRet: num(totals.avgRetPitch, 30),
      pitchChk: num(totals.avgPitchChk, 12),
      chkVenda: num(totals.avgChkVenda, 60),
    };
  }, [totals]);

  const [inputs, setInputs] = useState<SimInputs>(baselineInputs);
  const [actualInputs, setActualInputs] = useState<SimInputs>(baselineInputs);

  // Quando o período muda e o usuário ainda não tocou em nada, atualiza baseline
  useEffect(() => {
    setInputs(baselineInputs);
    setActualInputs(baselineInputs);
  }, [baselineInputs]);

  const baseResult = useMemo(() => runSim(actualInputs), [actualInputs]);
  const simResult = useMemo(() => runSim(inputs), [inputs]);

  const update = <K extends keyof SimInputs>(k: K, v: SimInputs[K]) =>
    setInputs((p) => ({ ...p, [k]: v }));

  const updateActual = <K extends keyof SimInputs>(k: K, v: SimInputs[K]) =>
    setActualInputs((p) => ({ ...p, [k]: v }));

  const reset = () => {
    setInputs(baselineInputs);
    setActualInputs(baselineInputs);
  };

  // Sensibilidade: varia uma variável de -30% a +30% e mostra impacto incremental.
  const [sensVar, setSensVar] = useState<keyof SimInputs>("chkVenda");

  // Ranking de sensibilidade: mede quanto o lucro muda quando cada variável sobe +10%
  const sensitivityRanking = useMemo(() => {
    const vars: { key: keyof SimInputs; label: string }[] = [
      { key: "ctr", label: "CTR" },
      { key: "connectRate", label: "Connect Rate" },
      { key: "playRate", label: "Play Rate" },
      { key: "pitchRet", label: "Pitch Retention" },
      { key: "pitchChk", label: "Pitch → Checkout" },
      { key: "chkVenda", label: "Checkout → Venda" },
      { key: "ticketFront", label: "Ticket Front" },
      { key: "ticketBump", label: "Ticket Bump" },
      { key: "ticketUpsell", label: "Ticket Upsell" },
      { key: "takeRateBump", label: "Take-rate Bump" },
      { key: "takeRateUpsell", label: "Take-rate Upsell" },
      { key: "investimento", label: "Investimento" },
      { key: "impressoes", label: "Impressões" },
    ];
    const baseLucro = simResult.lucro;
    const ranked = vars
      .map((v) => {
        const base = inputs[v.key];
        if (!base) return { ...v, deltaLucro: 0, deltaPct: 0 };
        const next = { ...inputs, [v.key]: base * 1.1 };
        const newLucro = runSim(next).lucro;
        const deltaLucro = newLucro - baseLucro;
        const deltaPct = baseLucro ? (deltaLucro / Math.abs(baseLucro)) * 100 : 0;
        return { ...v, deltaLucro, deltaPct };
      })
      .sort((a, b) => Math.abs(b.deltaLucro) - Math.abs(a.deltaLucro));
    return ranked;
  }, [inputs, simResult.lucro]);

  const topSensitive = sensitivityRanking[0];

  const sensitivityData = useMemo(() => {
    const base = inputs[sensVar];
    if (!base) return [];
    const baseScenario = runSim(inputs);
    const points: SensitivityPoint[] = [];
    for (let pct = -30; pct <= 30; pct += 5) {
      const value = base * (1 + pct / 100);
      const next = { ...inputs, [sensVar]: value };
      const r = runSim(next);
      points.push({
        delta: (pct > 0 ? "+" : "") + pct + "%",
        value,
        lucro: Math.round(r.lucro),
        fat: Math.round(r.fatLiquido),
        lucroDelta: Math.round(r.lucro - baseScenario.lucro),
        fatDelta: Math.round(r.fatLiquido - baseScenario.fatLiquido),
      });
    }
    return points;
  }, [inputs, sensVar]);
  const selectedSensitivityLabel = sensitivityRanking.find((item) => item.key === sensVar)?.label ?? String(sensVar);
  const sensitivityLow = sensitivityData[0] ?? null;
  const sensitivityHigh = sensitivityData[sensitivityData.length - 1] ?? null;

  // ===== Salvar / Histórico de simulações =====
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const [saveOpen, setSaveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [simName, setSimName] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SavedSimulation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    let q = supabase
      .from("simulations")
      .select("id, name, inputs, result, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (currentWorkspace?.id) q = q.eq("workspace_id", currentWorkspace.id);
    if (projectId) q = q.eq("project_id", projectId);
    const { data, error } = await q;
    setLoadingHistory(false);
    if (error) {
      toast.error("Erro ao carregar histórico", { description: error.message });
      return;
    }
    setHistory((data || []) as unknown as SavedSimulation[]);
  }, [currentWorkspace?.id, projectId]);

  const handleSave = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      toast.error("Faça login para salvar simulações");
      return;
    }
    if (!currentWorkspace?.id) {
      setSaving(false);
      toast.error("Selecione um workspace antes de salvar");
      return;
    }
    const { error } = await supabase.from("simulations").insert({
      user_id: user.id,
      workspace_id: currentWorkspace.id,
      project_id: projectId,
      name: simName.trim() || null,
      inputs: inputs as unknown as Record<string, number>,
      result: simResult as unknown as Record<string, number | null>,
    });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar", { description: error.message });
      return;
    }
    toast.success("Simulação salva");
    setSimName("");
    setSaveOpen(false);
    loadHistory();
  };

  const handleLoad = (sim: SavedSimulation) => {
    setInputs(sim.inputs);
    setHistoryOpen(false);
    toast.success(sim.name ? `Carregado: ${sim.name}` : "Simulação carregada");
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("simulations").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir", { description: error.message });
      return;
    }
    setHistory((p) => p.filter((s) => s.id !== id));
    toast.success("Simulação removida");
  };

  const openHistory = () => {
    setHistoryOpen(true);
    loadHistory();
  };

  if (!rows.length) {
    return (
      <div className="section-card text-center py-16 text-muted-foreground animate-fade-in">
        Carregue um CSV para usar o simulador.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_420px] gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <SectionCard
            title="Tickets"
            subtitle="Valor medio por venda"
            right={
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={openHistory} className="gap-1.5 h-8">
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Historico</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 h-8">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Resetar</span>
                </Button>
                <Button size="sm" onClick={() => setSaveOpen(true)} className="gap-1.5 h-8">
                  <Save className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Salvar</span>
                </Button>
              </div>
            }
          >
            <div className="grid sm:grid-cols-3 gap-3">
              <NumberField
                label="Ticket Front" prefix="R$" value={inputs.ticketFront} step={1}
                onChange={(v) => update("ticketFront", v)}
              />
              <NumberField
                label="Ticket Order Bump" prefix="R$" value={inputs.ticketBump} step={1}
                onChange={(v) => update("ticketBump", v)}
              />
              <NumberField
                label="Ticket Upsell" prefix="R$" value={inputs.ticketUpsell} step={1}
                onChange={(v) => update("ticketUpsell", v)}
              />
            </div>
          </SectionCard>

          <SectionCard title="Aquisição" subtitle="Topo do funil e custo">
            <div className="grid sm:grid-cols-2 gap-3">
              <NumberField
                label="Impressões" value={inputs.impressoes} step={1000}
                onChange={(v) => update("impressoes", v)}
              />
              <NumberField
                label="Investimento" prefix="R$" value={inputs.investimento} step={100}
                onChange={(v) => update("investimento", v)}
              />
            </div>
          </SectionCard>

          <SectionCard title="Taxas do Funil — Atual" subtitle="Médias do período (editável para ajustes manuais)">
            <div className="grid sm:grid-cols-2 gap-4">
              <SliderField label="CTR" suffix="%" value={actualInputs.ctr} min={0} max={10} step={0.05}
                onChange={(v) => updateActual("ctr", v)} variant="muted" />
              <SliderField label="Connect Rate (taxa carreg.)" suffix="%" value={actualInputs.connectRate}
                min={0} max={100} step={0.5} onChange={(v) => updateActual("connectRate", v)} variant="muted" />
              <SliderField label="Play Rate" suffix="%" value={actualInputs.playRate} min={0} max={100} step={0.5}
                onChange={(v) => updateActual("playRate", v)} variant="muted" />
              <SliderField label="Pitch Retention" suffix="%" value={actualInputs.pitchRet} min={0} max={100} step={0.5}
                onChange={(v) => updateActual("pitchRet", v)} variant="muted" />
              <SliderField label="Pitch → Checkout" suffix="%" value={actualInputs.pitchChk} min={0} max={100} step={0.5}
                onChange={(v) => updateActual("pitchChk", v)} variant="muted" />
              <SliderField label="Checkout → Venda" suffix="%" value={actualInputs.chkVenda} min={0} max={100} step={0.5}
                onChange={(v) => updateActual("chkVenda", v)} variant="muted" />
              <SliderField label="Take-rate Order Bump" suffix="%" value={actualInputs.takeRateBump}
                min={0} max={100} step={0.5} onChange={(v) => updateActual("takeRateBump", v)} variant="muted" />
              <SliderField label="Take-rate Upsell" suffix="%" value={actualInputs.takeRateUpsell}
                min={0} max={100} step={0.5} onChange={(v) => updateActual("takeRateUpsell", v)} variant="muted" />
            </div>
          </SectionCard>

          <SectionCard title="Taxas do Funil — Simulado" subtitle="Ajuste para recalcular o resultado">
            <div className="grid sm:grid-cols-2 gap-4">
              <SliderField label="CTR" suffix="%" value={inputs.ctr} min={0} max={10} step={0.05}
                onChange={(v) => update("ctr", v)} />
              <SliderField label="Connect Rate (taxa carreg.)" suffix="%" value={inputs.connectRate}
                min={0} max={100} step={0.5} onChange={(v) => update("connectRate", v)} />
              <SliderField label="Play Rate" suffix="%" value={inputs.playRate} min={0} max={100} step={0.5}
                onChange={(v) => update("playRate", v)} />
              <SliderField label="Pitch Retention" suffix="%" value={inputs.pitchRet} min={0} max={100} step={0.5}
                onChange={(v) => update("pitchRet", v)} />
              <SliderField label="Pitch → Checkout" suffix="%" value={inputs.pitchChk} min={0} max={100} step={0.5}
                onChange={(v) => update("pitchChk", v)} />
              <SliderField label="Checkout → Venda" suffix="%" value={inputs.chkVenda} min={0} max={100} step={0.5}
                onChange={(v) => update("chkVenda", v)} />
              <SliderField label="Take-rate Order Bump" suffix="%" value={inputs.takeRateBump}
                min={0} max={100} step={0.5} onChange={(v) => update("takeRateBump", v)} />
              <SliderField label="Take-rate Upsell" suffix="%" value={inputs.takeRateUpsell}
                min={0} max={100} step={0.5} onChange={(v) => update("takeRateUpsell", v)} />
            </div>
          </SectionCard>
        </div>

        {/* Resultados */}
        <div className="space-y-4">
          <SectionCard title="Resultado simulado" subtitle="Atual → Simulado">
            <div className="space-y-2">
              <ComparisonRow label="Faturamento" base={baseResult.fatLiquido} sim={simResult.fatLiquido} fmt={fBRL} />
              <ComparisonRow label="Lucro" base={baseResult.lucro} sim={simResult.lucro} fmt={fBRL} highlight />
              <ComparisonRow label="ROI" base={baseResult.roi} sim={simResult.roi} fmt={(v) => fMult(v ?? null)} />
              <ComparisonRow label="CAC" base={baseResult.cac} sim={simResult.cac} fmt={fBRL} invert />
              <ComparisonRow label="AOV" base={baseResult.aov} sim={simResult.aov} fmt={fBRL} />
              <ComparisonRow label="CPM" base={baseResult.cpm} sim={simResult.cpm} fmt={fBRL} invert />
              <ComparisonRow label="Vendas Totais" base={baseResult.vendasTotais} sim={simResult.vendasTotais}
                fmt={(v) => fNum(Math.round(v ?? 0))} />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Funnel breakdown */}
      <SectionCard title="Cascata do funil" subtitle="Quantos chegam em cada etapa">
        <FunnelBreakdown base={baseResult} sim={simResult} />
      </SectionCard>

      {/* Sensibilidade */}
      <SectionCard
        title="Análise de sensibilidade"
        subtitle="Impacto incremental ao variar uma única alavanca de -30% a +30%"
        right={
          <select
            value={sensVar}
            onChange={(e) => setSensVar(e.target.value as keyof SimInputs)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2"
          >
            <option value="chkVenda">Checkout → Venda</option>
            <option value="ctr">CTR</option>
            <option value="connectRate">Connect Rate</option>
            <option value="playRate">Play Rate</option>
            <option value="pitchRet">Pitch Retention</option>
            <option value="pitchChk">Pitch → Checkout</option>
            <option value="ticketFront">Ticket Front</option>
            <option value="ticketBump">Ticket Bump</option>
            <option value="ticketUpsell">Ticket Upsell</option>
            <option value="takeRateBump">Take-rate Bump</option>
            <option value="takeRateUpsell">Take-rate Upsell</option>
            <option value="investimento">Investimento</option>
            <option value="impressoes">Impressões</option>
          </select>
        }
      >
        {topSensitive && topSensitive.deltaLucro !== 0 && (
          <div className="mb-3 flex items-start gap-2.5 p-2.5 rounded-md bg-primary/5 border border-primary/20">
            <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <Wand2 className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Alavanca mais sensível
              </div>
              <div className="text-sm font-semibold text-foreground mt-0.5">
                {topSensitive.label}
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  +10% ={" "}
                  <span className={cn(
                    "font-semibold",
                    topSensitive.deltaLucro > 0 ? "text-kpi-emerald" : "text-kpi-red",
                  )}>
                    {topSensitive.deltaLucro > 0 ? "+" : ""}{fBRL(topSensitive.deltaLucro)} de lucro
                  </span>
                </span>
              </div>
            </div>
            {sensVar !== topSensitive.key && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] shrink-0"
                onClick={() => setSensVar(topSensitive.key)}
              >
                Analisar
              </Button>
            )}
          </div>
        )}
        {sensitivityLow && sensitivityHigh && (
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <SensitivitySummaryCard
              label="Alavanca"
              value={selectedSensitivityLabel}
              detail={`${formatSensitivityValue(sensitivityLow.value, sensVar)} → ${formatSensitivityValue(sensitivityHigh.value, sensVar)}`}
            />
            <SensitivitySummaryCard
              label="Impacto no lucro"
              value={`${formatSignedCurrency(sensitivityLow.lucroDelta)} / ${formatSignedCurrency(sensitivityHigh.lucroDelta)}`}
              detail="mínimo e máximo no intervalo"
            />
            <SensitivitySummaryCard
              label="Impacto no faturamento"
              value={`${formatSignedCurrency(sensitivityLow.fatDelta)} / ${formatSignedCurrency(sensitivityHigh.fatDelta)}`}
              detail="variação contra o cenário simulado"
            />
          </div>
        )}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sensitivityData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="delta" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11}
                tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => {
                  if (name === "lucroDelta") return [formatSignedCurrency(v), "Impacto no lucro"];
                  if (name === "fatDelta") return [formatSignedCurrency(v), "Impacto no faturamento"];
                  return [fBRL(v), name];
                }}
                labelFormatter={(label, payload) => {
                  const point = payload?.[0]?.payload as SensitivityPoint | undefined;
                  return point
                    ? `${label} · ${formatSensitivityValue(point.value, sensVar)}`
                    : String(label);
                }}
              />
              <Line type="monotone" dataKey="fatDelta" name="fatDelta" stroke="hsl(var(--kpi-blue))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="lucroDelta" name="lucroDelta" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Mantém todas as outras variáveis fixas e mostra a diferença contra o cenário simulado atual.
        </p>
      </SectionCard>

      {/* Top alavancas */}
      <SectionCard
        title="Ranking de alavancas"
        subtitle="Impacto no lucro com +10% em cada variável (todas comparáveis)"
      >
        <div className="space-y-1.5">
          {sensitivityRanking.slice(0, 5).map((v, idx) => {
            const max = Math.abs(sensitivityRanking[0]?.deltaLucro || 1);
            const widthPct = Math.max(2, (Math.abs(v.deltaLucro) / max) * 100);
            const positive = v.deltaLucro >= 0;
            return (
              <button
                key={v.key}
                onClick={() => setSensVar(v.key)}
                className={cn(
                  "w-full flex items-center gap-3 p-1.5 rounded-md hover:bg-secondary/40 transition-colors text-left",
                  sensVar === v.key && "bg-primary/5 ring-1 ring-primary/20",
                )}
              >
                <div className="w-6 text-[11px] font-bold text-muted-foreground tabular-nums shrink-0">
                  #{idx + 1}
                </div>
                <div className="w-32 text-xs text-foreground shrink-0 truncate">{v.label}</div>
                <div className="flex-1 h-6 bg-secondary/40 rounded-md relative overflow-hidden">
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-md transition-all",
                      positive
                        ? "bg-gradient-to-r from-kpi-emerald/80 to-kpi-emerald/40"
                        : "bg-gradient-to-r from-kpi-red/80 to-kpi-red/40",
                    )}
                    style={{ width: `${widthPct}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2.5">
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                      {positive ? "+" : ""}{fBRL(v.deltaLucro)}
                    </span>
                  </div>
                </div>
                <div className="w-14 text-right text-[11px] font-semibold tabular-nums shrink-0 text-muted-foreground">
                  {v.deltaPct > 0 ? "+" : ""}{v.deltaPct.toFixed(1)}%
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Dialog: Salvar simulação */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Salvar simulação</DialogTitle>
            <DialogDescription>
              Dê um nome para identificar esse cenário no histórico (opcional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nome</label>
              <Input
                placeholder="Ex: Cenário agressivo, Meta Q2..."
                value={simName}
                onChange={(e) => setSimName(e.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="rounded-md bg-secondary/40 p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Faturamento</span>
                <span className="font-semibold tabular-nums">{fBRL(simResult.fatLiquido)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lucro</span>
                <span className={cn(
                  "font-semibold tabular-nums",
                  simResult.lucro >= 0 ? "text-kpi-emerald" : "text-kpi-red",
                )}>
                  {fBRL(simResult.lucro)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ROI</span>
                <span className="font-semibold tabular-nums">{fMult(simResult.roi)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Histórico */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-4 h-4" />
              Histórico de simulações
            </DialogTitle>
            <DialogDescription>
              {projectId
                ? "Mostrando simulações deste projeto. Clique em uma para carregar."
                : "Mostrando todas as suas simulações. Clique em uma para carregar."}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Carregando…
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                Nenhuma simulação salva ainda.
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((sim) => {
                  const lucro = Number(sim.result?.lucro ?? 0);
                  const fat = Number(sim.result?.fatLiquido ?? 0);
                  const roi = sim.result?.roi as number | null | undefined;
                  return (
                    <div
                      key={sim.id}
                      className="group flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-secondary/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">
                          {sim.name || "Sem nome"}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(sim.created_at).toLocaleString("pt-BR")}
                        </div>
                        <div className="flex gap-3 mt-1.5 text-xs">
                          <span className="text-muted-foreground">
                            Fat: <span className="text-foreground font-semibold tabular-nums">{fBRL(fat)}</span>
                          </span>
                          <span className="text-muted-foreground">
                            Lucro:{" "}
                            <span className={cn(
                              "font-semibold tabular-nums",
                              lucro >= 0 ? "text-kpi-emerald" : "text-kpi-red",
                            )}>
                              {fBRL(lucro)}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            ROI: <span className="text-foreground font-semibold tabular-nums">{fMult(roi ?? null)}</span>
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => handleLoad(sim)}
                      >
                        <Play className="w-3.5 h-3.5" />
                        Carregar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-kpi-red"
                        onClick={() => handleDelete(sim.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ============= Subcomponents =============

const SectionCard = ({
  title, subtitle, children, right,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <section className="section-card">
    <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-1 h-4 bg-primary rounded-full" />
          {title}
        </h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 ml-3">{subtitle}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const NumberField = ({
  label, value, onChange, prefix, step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  step?: number;
}) => (
  <div className="space-y-1">
    <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
    <div className="relative">
      {prefix && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {prefix}
        </span>
      )}
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={cn("h-9 text-sm tabular-nums", prefix && "pl-9")}
      />
    </div>
  </div>
);

const SliderField = ({
  label, value, onChange, min, max, step, suffix, variant = "default",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  variant?: "default" | "muted";
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <span className={cn("text-xs font-semibold tabular-nums", variant === "muted" ? "text-kpi-green" : "text-foreground")}>
        {value.toFixed(step < 1 ? 2 : 0)}
        {suffix}
      </span>
    </div>
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(arr) => onChange(arr[0])}
      className={variant === "muted" ? "[&_[role=slider]]:border-kpi-green [&_.bg-primary]:bg-kpi-green" : ""}
    />
  </div>
);

const SensitivitySummaryCard = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</div>
    <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>
  </div>
);

const ReadOnlyRate = ({ label, value }: { label: string; value: number }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {value.toFixed(2)}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-muted-foreground/40 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const ComparisonRow = ({
  label, base, sim, fmt, highlight, invert,
}: {
  label: string;
  base: number | null;
  sim: number | null;
  fmt: (v: number | null) => string;
  highlight?: boolean;
  invert?: boolean; // true para métricas onde menor é melhor (CAC, CPM)
}) => {
  const baseN = base ?? 0;
  const simN = sim ?? 0;
  const diff = simN - baseN;
  const pct = baseN ? (diff / Math.abs(baseN)) * 100 : 0;
  const better = invert ? diff < 0 : diff > 0;
  const Icon = (invert ? diff < 0 : diff > 0) ? TrendingUp : TrendingDown;
  const colorCls = diff === 0
    ? "text-muted-foreground"
    : better
    ? "text-kpi-emerald"
    : "text-kpi-red";

  return (
    <div className={cn(
      "flex items-center gap-3 py-2 px-3 rounded-md",
      highlight && "bg-primary/5 border border-primary/20",
    )}>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground tabular-nums">{fmt(base)}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className={cn("text-sm font-bold tabular-nums", highlight && "text-base")}>
            {fmt(sim)}
          </span>
        </div>
      </div>
      {baseN !== 0 && (
        <div className={cn("flex items-center gap-1 text-xs font-semibold tabular-nums shrink-0", colorCls)}>
          <Icon className="w-3 h-3" />
          {pct > 0 ? "+" : ""}
          {pct.toFixed(1)}%
        </div>
      )}
    </div>
  );
};

function formatSignedCurrency(value: number) {
  if (!Number.isFinite(value) || value === 0) return fBRL(0);
  return `${value > 0 ? "+" : ""}${fBRL(value)}`;
}

function formatSensitivityValue(value: number, key: keyof SimInputs) {
  if (key.startsWith("ticket") || key === "investimento") return fBRL(value);
  if (key === "impressoes") return fNum(Math.round(value));
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

const FunnelBreakdown = ({ base, sim }: { base: SimResult; sim: SimResult }) => {
  const stages: { label: string; baseV: number; simV: number }[] = [
    { label: "Impressões", baseV: 0, simV: 0 }, // preenchido abaixo se necessário — usamos cliques+ como base
    { label: "Cliques no link", baseV: base.cliques, simV: sim.cliques },
    { label: "LP Views", baseV: base.pageviews, simV: sim.pageviews },
    { label: "Plays", baseV: base.plays, simV: sim.plays },
    { label: "Pitches", baseV: base.pitches, simV: sim.pitches },
    { label: "Checkouts", baseV: base.checkouts, simV: sim.checkouts },
    { label: "Vendas Front", baseV: base.vendasFront, simV: sim.vendasFront },
    { label: "Vendas Bump", baseV: base.vendasBump, simV: sim.vendasBump },
    { label: "Vendas Upsell", baseV: base.vendasUpsell, simV: sim.vendasUpsell },
  ].filter((s) => s.label !== "Impressões"); // remove placeholder

  const maxSim = Math.max(...stages.map((s) => s.simV), 1);

  return (
    <div className="space-y-1.5">
      {stages.map((s) => {
        const widthPct = Math.max(2, (s.simV / maxSim) * 100);
        const diff = s.simV - s.baseV;
        const pct = s.baseV ? (diff / s.baseV) * 100 : 0;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-32 text-xs text-muted-foreground shrink-0">{s.label}</div>
            <div className="flex-1 h-7 bg-secondary/40 rounded-md relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary/40 rounded-md transition-all"
                style={{ width: `${widthPct}%` }}
              />
              <div className="absolute inset-0 flex items-center px-2.5 justify-between">
                <span className="text-xs font-semibold text-foreground tabular-nums">
                  {fNum(Math.round(s.simV))}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  base: {fNum(Math.round(s.baseV))}
                </span>
              </div>
            </div>
            <div className={cn(
              "w-16 text-right text-xs font-semibold tabular-nums shrink-0",
              s.baseV === 0 ? "text-muted-foreground" : pct > 0 ? "text-kpi-emerald" : pct < 0 ? "text-kpi-red" : "text-muted-foreground",
            )}>
              {s.baseV === 0 ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// reduce unused-import noise
void fPct;

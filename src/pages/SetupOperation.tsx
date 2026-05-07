import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Copy, Loader2, Plug, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type StepId = "nome" | "meta" | "vturb" | "hubla" | "final";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "nome", label: "Operação" },
  { id: "meta", label: "Meta" },
  { id: "vturb", label: "VTurb" },
  { id: "hubla", label: "Hubla" },
  { id: "final", label: "Revisão" },
];

export default function SetupOperation() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const [step, setStep] = useState<StepId>("nome");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [metaAccountId, setMetaAccountId] = useState("");
  const [metaToken, setMetaToken] = useState("");
  const [metaLabel, setMetaLabel] = useState("");
  const [vturbKey, setVturbKey] = useState("");
  const [playersText, setPlayersText] = useState("");
  const [hublaSecret, setHublaSecret] = useState("");
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState("");

  // Test states
  const [testingMeta, setTestingMeta] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState<{ ok: boolean; name?: string; error?: string } | null>(null);
  const [testingVturb, setTestingVturb] = useState(false);
  const [vturbTestResult, setVturbTestResult] = useState<{ ok: boolean; players?: Array<{ id: string }>; error?: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, navigate, user]);

  const currentStepIndex = STEPS.findIndex((item) => item.id === step);
  const canSubmit = name.trim().length >= 2;
  const playerIds = useMemo(
    () => playersText.split(/\n|,|;/).map((value) => value.trim()).filter(Boolean),
    [playersText],
  );

  async function createOperation() {
    if (!user || !currentWorkspace?.id || !canSubmit) return;
    setSaving(true);
    try {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          workspace_id: currentWorkspace.id,
          name: name.trim(),
          source: "api",
          csv_content: null,
        })
        .select("id")
        .single();
      if (projectError || !project) throw projectError ?? new Error("Falha ao criar projeto");

      let metaRowId: string | null = null;
      if (metaAccountId.trim() && metaToken.trim()) {
        const normalized = normalizeAccountId(metaAccountId);
        const { data: metaRow, error: metaError } = await supabase
          .from("workspace_meta_accounts")
          .upsert({
            workspace_id: currentWorkspace.id,
            account_id: normalized,
            access_token: metaToken.trim(),
            label: metaLabel.trim() || normalized,
            created_by: user.id,
          }, { onConflict: "workspace_id,account_id" })
          .select("id")
          .single();
        if (metaError || !metaRow) throw metaError ?? new Error("Falha ao salvar Meta");
        metaRowId = metaRow.id;
        const { error } = await supabase.from("project_meta_accounts").insert({
          project_id: project.id,
          meta_account_id: metaRowId,
        });
        if (error) throw error;
      }

      if (vturbKey.trim() || hublaSecret.trim()) {
        const { error } = await supabase.from("workspace_integrations").upsert({
          workspace_id: currentWorkspace.id,
          vturb_api_key: vturbKey.trim() || null,
          gateway_provider: hublaSecret.trim() ? "hubla" : null,
          gateway_webhook_secret: hublaSecret.trim() || null,
          created_by: user.id,
        }, { onConflict: "workspace_id" });
        if (error) throw error;
      }

      if (playerIds.length > 0) {
        for (const playerId of playerIds) {
          const { data: player, error: playerError } = await supabase
            .from("workspace_vturb_players")
            .upsert({
              workspace_id: currentWorkspace.id,
              player_id: playerId,
              label: playerId,
              created_by: user.id,
            }, { onConflict: "workspace_id,player_id" })
            .select("id")
            .single();
          if (playerError || !player) throw playerError ?? new Error("Falha ao salvar player");
          const { error } = await supabase.from("project_vturb_players").insert({
            project_id: project.id,
            vturb_player_id: player.id,
          });
          if (error) throw error;
        }
      }

      const webhookToken = randomHex(24);
      const { error: checkoutError } = await supabase.from("project_checkout_bindings").upsert({
        project_id: project.id,
        webhook_token: webhookToken,
        enabled: true,
      });
      if (checkoutError) throw checkoutError;

      const provider = hublaSecret.trim() ? "hubla" : "hubla";
      const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook-gateway/${provider}/${webhookToken}`;
      setCreatedWebhookUrl(webhookUrl);
      toast.success("Operação criada");
      navigate(`/diagnostics?project=${project.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar operação");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="max-w-[900px] mx-auto px-4 md:px-6 py-6 md:py-8">
      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Projetos
          </Button>
          <div>
            <h1 className="text-xl font-bold">Nova Operacao</h1>
            <p className="text-xs text-muted-foreground">Configure suas fontes de dados em poucos passos.</p>
          </div>
        </div>
      </header>

      <div className="section-card">
        <div className="grid grid-cols-5 gap-2 mb-6">
          {STEPS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStep(item.id)}
              className={cn(
                "h-9 rounded-md border text-xs font-medium",
                step === item.id ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground",
                index < currentStepIndex && "text-green-600",
              )}
            >
              {index < currentStepIndex ? <Check className="w-3.5 h-3.5 inline mr-1" /> : null}
              {item.label}
            </button>
          ))}
        </div>

        {step === "nome" && (
          <StepSection title="Nome da operação">
            <Label htmlFor="operation-name">Nome</Label>
            <Input id="operation-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Projeto Yasmin" />
          </StepSection>
        )}

        {step === "meta" && (
          <StepSection title="Meta Ads">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Ad account ID">
                <Input value={metaAccountId} onChange={(e) => setMetaAccountId(e.target.value)} placeholder="act_123 ou 123" />
              </Field>
              <Field label="Nome interno">
                <Input value={metaLabel} onChange={(e) => setMetaLabel(e.target.value)} placeholder="Kosmos" />
              </Field>
            </div>
            <Field label="Access token">
              <Input value={metaToken} onChange={(e) => setMetaToken(e.target.value)} type="password" placeholder="Cole o token Meta" />
            </Field>
            <div className="flex items-center gap-3 mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!metaAccountId.trim() || !metaToken.trim() || testingMeta}
                onClick={async () => {
                  setTestingMeta(true);
                  setMetaTestResult(null);
                  try {
                    const { data, error } = await supabase.functions.invoke("meta-test", {
                      body: { account_id: normalizeAccountId(metaAccountId), access_token: metaToken },
                    });
                    if (error || data?.error) {
                      setMetaTestResult({ ok: false, error: data?.error ?? error?.message });
                    } else {
                      setMetaTestResult({ ok: true, name: data?.name });
                    }
                  } catch (err) {
                    setMetaTestResult({ ok: false, error: err instanceof Error ? err.message : "Erro ao testar" });
                  } finally {
                    setTestingMeta(false);
                  }
                }}
                className="gap-2"
              >
                {testingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Testar Meta
              </Button>
              {metaTestResult && (
                <span className={cn("text-xs", metaTestResult.ok ? "text-green-600" : "text-red-600")}>
                  {metaTestResult.ok ? `Conectado: ${metaTestResult.name}` : metaTestResult.error}
                </span>
              )}
            </div>
          </StepSection>
        )}

        {step === "vturb" && (
          <StepSection title="VTurb">
            <Field label="API key">
              <Input value={vturbKey} onChange={(e) => setVturbKey(e.target.value)} type="password" placeholder="Cole a API key da VTurb" />
            </Field>
            <div className="flex items-center gap-3 mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!vturbKey.trim() || testingVturb}
                onClick={async () => {
                  setTestingVturb(true);
                  setVturbTestResult(null);
                  try {
                    const { data, error } = await supabase.functions.invoke("vturb-test", {
                      body: { api_key: vturbKey },
                    });
                    if (error || data?.error) {
                      setVturbTestResult({ ok: false, error: data?.error ?? error?.message });
                    } else {
                      setVturbTestResult({ ok: true, players: data?.players });
                      // Auto-fill players if empty
                      if (data?.players?.length > 0 && !playersText.trim()) {
                        setPlayersText(data.players.map((p: { id: string }) => p.id).join("\n"));
                      }
                    }
                  } catch (err) {
                    setVturbTestResult({ ok: false, error: err instanceof Error ? err.message : "Erro ao testar" });
                  } finally {
                    setTestingVturb(false);
                  }
                }}
                className="gap-2"
              >
                {testingVturb ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Detectar players
              </Button>
              {vturbTestResult && (
                <span className={cn("text-xs", vturbTestResult.ok ? "text-green-600" : "text-red-600")}>
                  {vturbTestResult.ok ? `${vturbTestResult.players?.length ?? 0} player(s) encontrados` : vturbTestResult.error}
                </span>
              )}
            </div>
            <Field label="Players">
              <Textarea value={playersText} onChange={(e) => setPlayersText(e.target.value)} placeholder="Um player ID por linha" rows={7} />
            </Field>
          </StepSection>
        )}

        {step === "hubla" && (
          <StepSection title="Hubla">
            <Field label="Token/secret do webhook">
              <Input value={hublaSecret} onChange={(e) => setHublaSecret(e.target.value)} type="password" placeholder="Cole o token da Hubla" />
            </Field>
            <p className="text-xs text-muted-foreground">
              A URL final é gerada ao criar a operação e aparece em Conexões/Diagnóstico sem placeholder.
            </p>
          </StepSection>
        )}

        {step === "final" && (
          <StepSection title="Revisão">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Review label="Operação" value={name || "Pendente"} ok={!!name.trim()} />
              <Review
                label="Meta"
                value={metaAccountId || "Pendente"}
                ok={!!metaAccountId.trim() && !!metaToken.trim()}
                testStatus={metaTestResult?.ok ? "success" : metaTestResult?.error ? "error" : undefined}
              />
              <Review
                label="VTurb"
                value={`${playerIds.length} player(s)`}
                ok={!!vturbKey.trim() && playerIds.length > 0}
                testStatus={vturbTestResult?.ok ? "success" : vturbTestResult?.error ? "error" : undefined}
              />
              <Review label="Hubla" value={hublaSecret ? "Secret configurado" : "Pendente"} ok={!!hublaSecret.trim()} />
            </div>
            {createdWebhookUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(createdWebhookUrl);
                  toast.success("Webhook copiado");
                }}
                className="gap-2"
              >
                <Copy className="w-4 h-4" />
                Copiar webhook
              </Button>
            )}
          </StepSection>
        )}

        <div className="flex justify-between gap-3 mt-6 pt-4 border-t border-border/50">
          <Button
            type="button"
            variant="outline"
            disabled={currentStepIndex === 0 || saving}
            onClick={() => setStep(STEPS[Math.max(0, currentStepIndex - 1)].id)}
          >
            Voltar
          </Button>
          {step === "final" ? (
            <Button type="button" disabled={!canSubmit || saving} onClick={createOperation} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              Criar operação
            </Button>
          ) : (
            <Button type="button" onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, currentStepIndex + 1)].id)}>
              Próximo
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

function StepSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Review({ label, value, ok, testStatus }: {
  label: string;
  value: string;
  ok: boolean;
  testStatus?: "success" | "error" | "pending";
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium mt-1">{value}</div>
      <div className={cn("text-[11px] mt-1",
        testStatus === "success" ? "text-green-600" :
        testStatus === "error" ? "text-red-600" :
        ok ? "text-green-600" : "text-amber-600"
      )}>
        {testStatus === "success" ? "Configurado e testado" :
         testStatus === "error" ? "Erro no teste" :
         ok ? "Configurado" : "Pendente"}
      </div>
    </div>
  );
}

function normalizeAccountId(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function randomHex(length: number) {
  return [...crypto.getRandomValues(new Uint8Array(length))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

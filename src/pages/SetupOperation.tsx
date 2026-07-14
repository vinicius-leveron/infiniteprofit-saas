import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Copy, Loader2, Plug, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { syncVturbUntilDone } from "@/lib/vturbSync";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SETUP_DRAFT_STORAGE_KEY = "infiniteprofit.setupOperationDraft";

type StepId = "nome" | "meta" | "vturb" | "hubla" | "final";
type SyncSource = "meta" | "vturb";

type SetupDraft = {
  step: StepId;
  name: string;
  selectedExistingMetaIds: string[];
  metaAccounts: SetupMetaAccountDraft[];
  vturbKey: string;
  playersText: string;
  hublaSecret: string;
  webhookToken: string;
};

type SetupMetaAccountDraft = {
  draftId: string;
  accountId: string;
  accessToken: string;
  label: string;
};

type WorkspaceMetaAccount = {
  id: string;
  account_id: string;
  label: string | null;
  last_synced_at: string | null;
};

type MetaTestResult = {
  ok: boolean;
  name?: string;
  error?: string;
};

type VturbDetectedPlayer = {
  id: string;
  name?: string | null;
};

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "nome", label: "Funil" },
  { id: "meta", label: "Meta" },
  { id: "vturb", label: "VTurb" },
  { id: "hubla", label: "Hubla" },
  { id: "final", label: "Revisão" },
];

export default function SetupOperation() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { currentWorkspace } = useWorkspace();
  const [step, setStep] = useState<StepId>("nome");
  const [saving, setSaving] = useState(false);
  const [savingLabel, setSavingLabel] = useState("Criar operação");
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [existingMetaAccounts, setExistingMetaAccounts] = useState<WorkspaceMetaAccount[]>([]);
  const [selectedExistingMetaIds, setSelectedExistingMetaIds] = useState<string[]>([]);
  const [metaAccounts, setMetaAccounts] = useState<SetupMetaAccountDraft[]>(() => [emptyMetaAccountDraft()]);
  const [vturbKey, setVturbKey] = useState("");
  const [playersText, setPlayersText] = useState("");
  const [hublaSecret, setHublaSecret] = useState("");
  const [webhookToken, setWebhookToken] = useState(() => randomHex(24));

  // Test states
  const [testingMetaKey, setTestingMetaKey] = useState<string | null>(null);
  const [metaTestResults, setMetaTestResults] = useState<Record<string, MetaTestResult>>({});
  const [testingVturb, setTestingVturb] = useState(false);
  const [vturbTestResult, setVturbTestResult] = useState<{ ok: boolean; players?: VturbDetectedPlayer[]; error?: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !userId) navigate("/auth", { replace: true });
  }, [authLoading, navigate, userId]);

  const draftStorageKey = useMemo(
    () => `${SETUP_DRAFT_STORAGE_KEY}.${currentWorkspace?.id ?? "global"}`,
    [currentWorkspace?.id],
  );
  const currentStepIndex = STEPS.findIndex((item) => item.id === step);
  const canSubmit = name.trim().length >= 2;
  const configuredNewMetaAccounts = metaAccounts.filter(hasAnyMetaAccountValue);
  const validNewMetaAccounts = configuredNewMetaAccounts.filter(isCompleteMetaAccount);
  const hasIncompleteMetaAccount = configuredNewMetaAccounts.some((account) => !isCompleteMetaAccount(account));
  const selectedExistingMetaAccounts = existingMetaAccounts.filter((account) =>
    selectedExistingMetaIds.includes(account.id)
  );
  const selectedMetaAccountKeys = [
    ...selectedExistingMetaAccounts.map((account) => existingMetaTestKey(account.id)),
    ...validNewMetaAccounts.map((account) => newMetaTestKey(account.draftId)),
  ];
  const metaAccountCount = new Set([
    ...selectedExistingMetaAccounts.map((account) => normalizeAccountId(account.account_id)),
    ...validNewMetaAccounts.map((account) => normalizeAccountId(account.accountId)),
  ]).size;
  const allSelectedMetaAccountsTested =
    metaAccountCount > 0 && selectedMetaAccountKeys.every((key) => metaTestResults[key]?.ok);
  const hasMetaTestError = selectedMetaAccountKeys.some((key) => metaTestResults[key]?.ok === false);
  const playerIds = useMemo(
    () => playersText.split(/\n|,|;/).map((value) => value.trim()).filter(Boolean),
    [playersText],
  );
  const selectedPlayerIdSet = useMemo(() => new Set(playerIds), [playerIds]);
  const detectedPlayers = vturbTestResult?.ok ? vturbTestResult.players ?? [] : [];
  const selectedDetectedPlayers = detectedPlayers.filter((player) => selectedPlayerIdSet.has(player.id));
  const webhookUrl = useMemo(
    () => `${SUPABASE_URL}/functions/v1/webhook-gateway/hubla/${webhookToken}`,
    [webhookToken],
  );

  function setPlayerIds(nextIds: string[]) {
    setPlayersText([...new Set(nextIds.map((id) => id.trim()).filter(Boolean))].join("\n"));
  }

  function toggleDetectedPlayer(playerId: string, checked: boolean) {
    const next = new Set(playerIds);
    if (checked) {
      next.add(playerId);
    } else {
      next.delete(playerId);
    }
    setPlayerIds([...next]);
  }

  function selectAllDetectedPlayers() {
    const next = new Set(playerIds);
    for (const player of detectedPlayers) {
      if (player.id.trim()) next.add(player.id.trim());
    }
    setPlayerIds([...next]);
  }

  function clearDetectedPlayers() {
    const detectedIds = new Set(detectedPlayers.map((player) => player.id.trim()).filter(Boolean));
    setPlayerIds(playerIds.filter((playerId) => !detectedIds.has(playerId)));
  }

  function toggleExistingMetaAccount(accountId: string, checked: boolean) {
    setSelectedExistingMetaIds((current) =>
      checked
        ? [...new Set([...current, accountId])]
        : current.filter((id) => id !== accountId)
    );
  }

  function updateMetaAccount(draftId: string, patch: Partial<SetupMetaAccountDraft>) {
    setMetaAccounts((current) =>
      current.map((account) => account.draftId === draftId ? { ...account, ...patch } : account)
    );
    setMetaTestResults((current) => {
      const key = newMetaTestKey(draftId);
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function removeMetaAccount(draftId: string) {
    setMetaAccounts((current) => {
      const next = current.filter((account) => account.draftId !== draftId);
      return next.length > 0 ? next : [emptyMetaAccountDraft()];
    });
    setMetaTestResults((current) => {
      const next = { ...current };
      delete next[newMetaTestKey(draftId)];
      return next;
    });
  }

  async function testExistingMetaAccount(account: WorkspaceMetaAccount) {
    const key = existingMetaTestKey(account.id);
    setTestingMetaKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("meta-test", {
        body: { meta_account_id: account.id },
      });
      const result = metaTestResultFromResponse(data, error);
      setMetaTestResults((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setMetaTestResults((current) => ({
        ...current,
        [key]: { ok: false, error: error instanceof Error ? error.message : "Erro ao testar" },
      }));
    } finally {
      setTestingMetaKey(null);
    }
  }

  async function testNewMetaAccount(account: SetupMetaAccountDraft) {
    const key = newMetaTestKey(account.draftId);
    setTestingMetaKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("meta-test", {
        body: {
          account_id: normalizeAccountId(account.accountId),
          access_token: account.accessToken.trim(),
        },
      });
      const result = metaTestResultFromResponse(data, error);
      setMetaTestResults((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setMetaTestResults((current) => ({
        ...current,
        [key]: { ok: false, error: error instanceof Error ? error.message : "Erro ao testar" },
      }));
    } finally {
      setTestingMetaKey(null);
    }
  }

  useEffect(() => {
    if (!currentWorkspace?.id) {
      setExistingMetaAccounts([]);
      return;
    }

    let cancelled = false;
    void supabase
      .from("workspace_meta_accounts")
      .select("id, account_id, label, last_synced_at")
      .eq("workspace_id", currentWorkspace.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Falha ao carregar contas Meta do workspace");
          return;
        }
        const accounts = (data ?? []) as WorkspaceMetaAccount[];
        const accountIds = new Set(accounts.map((account) => account.id));
        setExistingMetaAccounts(accounts);
        setSelectedExistingMetaIds((current) => current.filter((id) => accountIds.has(id)));
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspace?.id]);

  useEffect(() => {
    const draft = readSetupDraft(draftStorageKey) ?? emptySetupDraft();
    setStep(draft.step);
    setName(draft.name);
    setSelectedExistingMetaIds(draft.selectedExistingMetaIds);
    setMetaAccounts(draft.metaAccounts);
    setVturbKey(draft.vturbKey);
    setPlayersText(draft.playersText);
    setHublaSecret(draft.hublaSecret);
    setWebhookToken(draft.webhookToken);
    setMetaTestResults({});
    setVturbTestResult(null);
    setHydratedDraftKey(draftStorageKey);
  }, [draftStorageKey]);

  useEffect(() => {
    if (hydratedDraftKey !== draftStorageKey) return;

    const draft: SetupDraft = {
      step,
      name,
      selectedExistingMetaIds,
      metaAccounts,
      vturbKey,
      playersText,
      hublaSecret,
      webhookToken,
    };

    if (isSetupDraftEmpty(draft)) {
      sessionStorage.removeItem(draftStorageKey);
      return;
    }

    sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [
    draftStorageKey,
    hydratedDraftKey,
    hublaSecret,
    metaAccounts,
    name,
    playersText,
    selectedExistingMetaIds,
    step,
    vturbKey,
    webhookToken,
  ]);

  async function createOperation() {
    if (!user || !currentWorkspace?.id || !canSubmit) return;
    if (hasIncompleteMetaAccount) {
      setStep("meta");
      toast.error("Preencha o Ad Account ID e o access token de cada conta Meta adicionada.");
      return;
    }
    const duplicateMetaAccountId = findDuplicateMetaAccountId(validNewMetaAccounts);
    if (duplicateMetaAccountId) {
      setStep("meta");
      toast.error(`A conta ${duplicateMetaAccountId} foi adicionada mais de uma vez.`);
      return;
    }

    setSaving(true);
    setSavingLabel("Criando operação");
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

      const metaRowIds = new Set(selectedExistingMetaIds);
      for (const account of validNewMetaAccounts) {
        const normalized = normalizeAccountId(account.accountId);
        const { data: metaData, error: metaError } = await supabase.functions.invoke("workspace-credentials", {
          body: {
            action: "upsert_meta_account",
            workspace_id: currentWorkspace.id,
            account_id: normalized,
            access_token: account.accessToken.trim(),
            label: account.label.trim() || normalized,
          },
        });
        const metaRow = metaData?.meta_account;
        if (metaError || !metaRow) throw metaError ?? new Error("Falha ao salvar Meta");
        metaRowIds.add(metaRow.id);
      }

      if (metaRowIds.size > 0) {
        const { error } = await supabase.from("project_meta_accounts").upsert(
          [...metaRowIds].map((metaAccountId) => ({
            project_id: project.id,
            meta_account_id: metaAccountId,
          })),
          { onConflict: "project_id,meta_account_id" },
        );
        if (error) throw error;
      }

      if (vturbKey.trim() || hublaSecret.trim()) {
        const integrationBody: Record<string, unknown> = {
          action: "upsert_workspace_integration",
          workspace_id: currentWorkspace.id,
          vturb_api_key: vturbKey.trim() || undefined,
          gateway_webhook_secret: hublaSecret.trim() || undefined,
        };
        if (hublaSecret.trim()) integrationBody.gateway_provider = "hubla";

        const { error } = await supabase.functions.invoke("workspace-credentials", {
          body: integrationBody,
        });
        if (error) throw error;
      }

      if (playerIds.length > 0) {
        const vturbNamesById = new Map(
          (vturbTestResult?.players ?? [])
            .map((player) => [player.id.trim(), player.name?.trim() ?? ""] as const)
            .filter(([id, playerName]) => id && playerName),
        );

        for (const playerId of playerIds) {
          const playerLabel = vturbNamesById.get(playerId) || playerId;
          const { data: player, error: playerError } = await supabase
            .from("workspace_vturb_players")
            .upsert({
              workspace_id: currentWorkspace.id,
              player_id: playerId,
              label: playerLabel,
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

      const { error: checkoutError } = await supabase.from("project_checkout_bindings").upsert({
        project_id: project.id,
        webhook_token: webhookToken,
        enabled: true,
      });
      if (checkoutError) throw checkoutError;

      const provider = hublaSecret.trim() ? "hubla" : "hubla";
      const finalWebhookUrl = `${SUPABASE_URL}/functions/v1/webhook-gateway/${provider}/${webhookToken}`;

      const syncSources: SyncSource[] = [];
      if (metaRowIds.size > 0) syncSources.push("meta");
      if (vturbKey.trim() && playerIds.length > 0) syncSources.push("vturb");

      let syncFailures: string[] = [];
      if (syncSources.length > 0) {
        setSavingLabel("Sincronizando dados iniciais");
        const syncResults = await Promise.all(
          syncSources.map((source) => runInitialSync(project.id, source)),
        );
        syncFailures = syncResults
          .filter((result) => result.errors.length > 0)
          .map((result) => `${labelForSource(result.source)}: ${result.errors.join(" | ")}`);
      }

      sessionStorage.removeItem(draftStorageKey);

      if (syncFailures.length > 0) {
        toast.warning("Operação criada, mas a primeira sincronização precisa de atenção.");
      } else if (syncSources.length > 0) {
        toast.success("Operação criada e sincronização inicial concluída.");
      } else {
        toast.success("Operação criada");
      }
      void navigator.clipboard.writeText(finalWebhookUrl).catch(() => undefined);

      navigate(`/dashboard?project=${project.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar operação");
    } finally {
      setSaving(false);
      setSavingLabel("Criar operação");
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
            <h1 className="text-xl font-bold">Nova operação</h1>
            <p className="text-xs text-muted-foreground">
              Configure suas fontes de dados em poucos passos. O rascunho fica salvo automaticamente nesta aba.
            </p>
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
          <StepSection title="Nome do funil">
            <Label htmlFor="operation-name">Nome</Label>
            <Input id="operation-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Perpétuo Denise" />
          </StepSection>
        )}

        {step === "meta" && (
          <StepSection title="Meta Ads">
            {existingMetaAccounts.length > 0 && (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Contas já cadastradas no workspace</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedExistingMetaAccounts.length} de {existingMetaAccounts.length} selecionada(s)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedExistingMetaIds(existingMetaAccounts.map((account) => account.id))}
                    >
                      Selecionar todas
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedExistingMetaIds([])}>
                      Limpar
                    </Button>
                  </div>
                </div>
                <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {existingMetaAccounts.map((account) => {
                    const testKey = existingMetaTestKey(account.id);
                    const testResult = metaTestResults[testKey];
                    return (
                      <div
                        key={account.id}
                        className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-background/50 p-3"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <Checkbox
                            checked={selectedExistingMetaIds.includes(account.id)}
                            onCheckedChange={(checked) => toggleExistingMetaAccount(account.id, checked === true)}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{account.label || account.account_id}</div>
                            <div className="break-all font-mono text-xs text-muted-foreground">{account.account_id}</div>
                            {testResult && (
                              <div className={cn("mt-1 text-[11px]", testResult.ok ? "text-green-600" : "text-red-600")}>
                                {testResult.ok ? `Conectada${testResult.name ? `: ${testResult.name}` : ""}` : testResult.error}
                              </div>
                            )}
                          </div>
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Testar conta ${account.label || account.account_id}`}
                          onClick={() => testExistingMetaAccount(account)}
                          disabled={testingMetaKey === testKey}
                        >
                          {testingMetaKey === testKey
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Zap className="h-4 w-4" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {existingMetaAccounts.length > 0 ? "Adicionar outras contas" : "Adicionar contas Meta"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Você pode cadastrar várias contas agora; todas serão vinculadas a esta operação.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMetaAccounts((current) => [...current, emptyMetaAccountDraft()])}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar conta
                </Button>
              </div>

              {metaAccounts.map((account, index) => {
                const testKey = newMetaTestKey(account.draftId);
                const testResult = metaTestResults[testKey];
                const accountIdInputId = `meta-account-id-${account.draftId}`;
                const accountLabelInputId = `meta-account-label-${account.draftId}`;
                const accountTokenInputId = `meta-account-token-${account.draftId}`;
                return (
                  <div key={account.draftId} className="rounded-lg border border-border/50 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium text-muted-foreground">Conta {index + 1}</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMetaAccount(account.draftId)}
                        aria-label={`Remover conta ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Ad Account ID" htmlFor={accountIdInputId}>
                        <Input
                          id={accountIdInputId}
                          value={account.accountId}
                          onChange={(event) => updateMetaAccount(account.draftId, { accountId: event.target.value })}
                          placeholder="act_123 ou 123"
                        />
                      </Field>
                      <Field label="Nome interno" htmlFor={accountLabelInputId}>
                        <Input
                          id={accountLabelInputId}
                          value={account.label}
                          onChange={(event) => updateMetaAccount(account.draftId, { label: event.target.value })}
                          placeholder="Conta principal"
                        />
                      </Field>
                    </div>
                    <Field label="Access token" htmlFor={accountTokenInputId}>
                      <Input
                        id={accountTokenInputId}
                        value={account.accessToken}
                        onChange={(event) => updateMetaAccount(account.draftId, { accessToken: event.target.value })}
                        type="password"
                        placeholder="Cole o token Meta desta conta"
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!isCompleteMetaAccount(account) || testingMetaKey === testKey}
                        onClick={() => testNewMetaAccount(account)}
                        className="gap-2"
                      >
                        {testingMetaKey === testKey
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Zap className="h-4 w-4" />}
                        Testar conta
                      </Button>
                      {testResult && (
                        <span className={cn("text-xs", testResult.ok ? "text-green-600" : "text-red-600")}>
                          {testResult.ok ? `Conectada${testResult.name ? `: ${testResult.name}` : ""}` : testResult.error}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
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
            {detectedPlayers.length > 0 && (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Selecione os vídeos deste projeto</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedDetectedPlayers.length} de {detectedPlayers.length} player(s) selecionados
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={selectAllDetectedPlayers}>
                      Selecionar todos
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={clearDetectedPlayers}>
                      Limpar
                    </Button>
                  </div>
                </div>
                <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {detectedPlayers.map((player) => (
                    <label
                      key={player.id}
                      className="flex items-start gap-3 rounded-md border border-border/40 bg-background/50 p-3 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedPlayerIdSet.has(player.id)}
                        onCheckedChange={(checked) => toggleDetectedPlayer(player.id, checked === true)}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{player.name || player.id}</div>
                        <div className="text-xs text-muted-foreground font-mono break-all">{player.id}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Field label="Players selecionados ou IDs manuais">
              <Textarea
                value={playersText}
                onChange={(e) => setPlayersText(e.target.value)}
                placeholder="Selecione acima ou cole um player ID por linha"
                rows={5}
              />
            </Field>
          </StepSection>
        )}

        {step === "hubla" && (
          <StepSection title="Hubla">
            <Field label="Token/secret do webhook">
              <Input value={hublaSecret} onChange={(e) => setHublaSecret(e.target.value)} type="password" placeholder="Cole o token da Hubla" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Configure esta URL na Hubla para receber eventos de checkout desta operação.
            </p>
            <WebhookCopyButton url={webhookUrl} />
          </StepSection>
        )}

        {step === "final" && (
          <StepSection title="Revisão">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Review label="Funil" value={name || "Pendente"} ok={!!name.trim()} />
              <Review
                label="Meta"
                value={metaAccountCount > 0 ? `${metaAccountCount} conta(s) selecionada(s)` : "Pendente"}
                ok={metaAccountCount > 0 && !hasIncompleteMetaAccount}
                testStatus={allSelectedMetaAccountsTested ? "success" : hasMetaTestError ? "error" : undefined}
              />
              <Review
                label="VTurb"
                value={`${playerIds.length} player(s)`}
                ok={!!vturbKey.trim() && playerIds.length > 0}
                testStatus={vturbTestResult?.ok ? "success" : vturbTestResult?.error ? "error" : undefined}
              />
              <Review label="Hubla" value={hublaSecret ? "Secret configurado" : "Pendente"} ok={!!hublaSecret.trim()} />
            </div>
            <p className="text-xs text-muted-foreground">
              A primeira sincronização da Meta e da VTurb roda automaticamente ao criar a operação. Na primeira vez, pode levar alguns minutos.
            </p>
            <WebhookCopyButton url={webhookUrl} />
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
              {saving ? savingLabel : "Criar operação"}
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

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
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

function WebhookCopyButton({ url }: { url: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="text-[11px] text-muted-foreground">Webhook Hubla</div>
      <div className="mt-1 break-all font-mono text-xs">{url}</div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          toast.success("Webhook copiado");
        }}
        className="mt-3 gap-2"
      >
        <Copy className="w-4 h-4" />
        Copiar webhook
      </Button>
    </div>
  );
}

function normalizeAccountId(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function existingMetaTestKey(accountId: string) {
  return `existing:${accountId}`;
}

function newMetaTestKey(draftId: string) {
  return `new:${draftId}`;
}

function metaTestResultFromResponse(data: unknown, error: { message?: string } | null): MetaTestResult {
  const payload = data && typeof data === "object"
    ? data as { error?: unknown; name?: unknown }
    : {};
  const errorMessage = typeof payload.error === "string" ? payload.error : error?.message;
  if (errorMessage) return { ok: false, error: errorMessage };
  return {
    ok: true,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

function emptyMetaAccountDraft(): SetupMetaAccountDraft {
  return {
    draftId: randomHex(8),
    accountId: "",
    accessToken: "",
    label: "",
  };
}

function hasAnyMetaAccountValue(account: SetupMetaAccountDraft) {
  return Boolean(account.accountId.trim() || account.accessToken.trim() || account.label.trim());
}

function isCompleteMetaAccount(account: SetupMetaAccountDraft) {
  return Boolean(account.accountId.trim() && account.accessToken.trim());
}

function findDuplicateMetaAccountId(accounts: SetupMetaAccountDraft[]) {
  const accountIds = new Set<string>();
  for (const account of accounts) {
    const accountId = normalizeAccountId(account.accountId);
    if (accountIds.has(accountId)) return accountId;
    accountIds.add(accountId);
  }
  return null;
}

function readSetupDraft(storageKey: string) {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SetupDraft> & {
      metaAccountId?: unknown;
      metaToken?: unknown;
      metaLabel?: unknown;
    };
    const metaAccounts = readDraftMetaAccounts(parsed);
    return {
      step: isStepId(parsed.step) ? parsed.step : "nome",
      name: typeof parsed.name === "string" ? parsed.name : "",
      selectedExistingMetaIds: Array.isArray(parsed.selectedExistingMetaIds)
        ? [...new Set(parsed.selectedExistingMetaIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
        : [],
      metaAccounts,
      vturbKey: typeof parsed.vturbKey === "string" ? parsed.vturbKey : "",
      playersText: typeof parsed.playersText === "string" ? parsed.playersText : "",
      hublaSecret: typeof parsed.hublaSecret === "string" ? parsed.hublaSecret : "",
      webhookToken: typeof parsed.webhookToken === "string" && parsed.webhookToken.trim() ? parsed.webhookToken : randomHex(24),
    } satisfies SetupDraft;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

function readDraftMetaAccounts(parsed: Partial<SetupDraft> & {
  metaAccountId?: unknown;
  metaToken?: unknown;
  metaLabel?: unknown;
}) {
  if (Array.isArray(parsed.metaAccounts)) {
    const accounts = parsed.metaAccounts
      .map(parseDraftMetaAccount)
      .filter((account): account is SetupMetaAccountDraft => account !== null);
    if (accounts.length > 0) return accounts;
  }

  const legacyAccountId = typeof parsed.metaAccountId === "string" ? parsed.metaAccountId : "";
  const legacyAccessToken = typeof parsed.metaToken === "string" ? parsed.metaToken : "";
  const legacyLabel = typeof parsed.metaLabel === "string" ? parsed.metaLabel : "";
  if (legacyAccountId || legacyAccessToken || legacyLabel) {
    return [{
      draftId: randomHex(8),
      accountId: legacyAccountId,
      accessToken: legacyAccessToken,
      label: legacyLabel,
    }];
  }

  return [emptyMetaAccountDraft()];
}

function parseDraftMetaAccount(value: unknown): SetupMetaAccountDraft | null {
  if (!value || typeof value !== "object") return null;
  const account = value as Partial<SetupMetaAccountDraft>;
  return {
    draftId: typeof account.draftId === "string" && account.draftId ? account.draftId : randomHex(8),
    accountId: typeof account.accountId === "string" ? account.accountId : "",
    accessToken: typeof account.accessToken === "string" ? account.accessToken : "",
    label: typeof account.label === "string" ? account.label : "",
  };
}

function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && STEPS.some((step) => step.id === value);
}

function isSetupDraftEmpty(draft: SetupDraft) {
  return (
    draft.step === "nome" &&
    !draft.name.trim() &&
    draft.selectedExistingMetaIds.length === 0 &&
    draft.metaAccounts.every((account) => !hasAnyMetaAccountValue(account)) &&
    !draft.vturbKey.trim() &&
    !draft.playersText.trim() &&
    !draft.hublaSecret.trim()
  );
}

function emptySetupDraft(): SetupDraft {
  return {
    step: "nome",
    name: "",
    selectedExistingMetaIds: [],
    metaAccounts: [emptyMetaAccountDraft()],
    vturbKey: "",
    playersText: "",
    hublaSecret: "",
    webhookToken: randomHex(24),
  };
}

async function runInitialSync(projectId: string, source: SyncSource) {
  if (source === "vturb") {
    const result = await syncVturbUntilDone({ projectId, days: 30 });
    return {
      source,
      errors: result.errors,
    };
  }

  const { data, error } = await supabase.functions.invoke(source === "meta" ? "meta-pull" : "vturb-pull", {
    body: { project_id: projectId, days: 30 },
  });

  return {
    source,
    errors: [
      ...(error?.message ? [error.message] : []),
      ...extractSyncErrors(data),
    ],
  };
}

function extractSyncErrors(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const errors: string[] = [];
  const record = payload as { error?: unknown; results?: unknown[] };

  if (typeof record.error === "string" && record.error.trim()) {
    errors.push(record.error.trim());
  }

  if (Array.isArray(record.results)) {
    for (const result of record.results) {
      if (!result || typeof result !== "object") continue;
      const message = (result as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) {
        errors.push(message.trim());
      }
    }
  }

  return [...new Set(errors)];
}

function labelForSource(source: SyncSource) {
  return source === "meta" ? "Meta" : "VTurb";
}

function randomHex(length: number) {
  return [...crypto.getRandomValues(new Uint8Array(length))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

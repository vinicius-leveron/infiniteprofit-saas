import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock3,
  Database,
  Loader2,
  Plug,
  Radio,
  Search,
  Waypoints,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  saveFunnelActivationPlan,
  type ActivationSource,
  type ActivationSyncSource,
} from "@/lib/funnelActivation";
import type {
  SetupDraftV2,
  SetupSource,
  SetupStepId as StepId,
} from "@/lib/setupDraft";
import { cn } from "@/lib/utils";

const SETUP_DRAFT_STORAGE_KEY = "infiniteprofit.setupOperationDraft";

type SourceSetupStatus = "not_started" | "configured" | "skipped" | "error";

type DiscoveredMetaAccount = {
  accountId: string;
  name: string | null;
  accountStatus: number | null;
  currency: string | null;
  timezone: string | null;
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
  { id: "nome", label: "Nome" },
  { id: "fontes", label: "Fontes opcionais" },
  { id: "revisao", label: "Revisão" },
];

export default function SetupOperation() {
  const navigate = useNavigate();
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const {
    currentWorkspace,
    workspaces,
    loading: workspaceLoading,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const client =
    workspaces.find((workspace) => workspace.id === routeClientId) ??
    currentWorkspace;
  const [step, setStep] = useState<StepId>("nome");
  const [saving, setSaving] = useState(false);
  const [savingLabel, setSavingLabel] = useState("Criar funil");
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [skippedSources, setSkippedSources] = useState<SetupSource[]>([]);
  const [existingMetaAccounts, setExistingMetaAccounts] = useState<WorkspaceMetaAccount[]>([]);
  const [selectedExistingMetaIds, setSelectedExistingMetaIds] = useState<string[]>([]);
  const [metaToken, setMetaToken] = useState("");
  const [discoveredMetaAccounts, setDiscoveredMetaAccounts] = useState<DiscoveredMetaAccount[]>([]);
  const [selectedDiscoveredMetaIds, setSelectedDiscoveredMetaIds] = useState<string[]>([]);
  const [discoveredMetaToken, setDiscoveredMetaToken] = useState("");
  const [discoveringMetaAccounts, setDiscoveringMetaAccounts] = useState(false);
  const [metaDiscoveryError, setMetaDiscoveryError] = useState<string | null>(null);
  const [vturbKey, setVturbKey] = useState("");
  const [playersText, setPlayersText] = useState("");
  const [hublaSecret, setHublaSecret] = useState("");

  // Test states
  const [testingMetaKey, setTestingMetaKey] = useState<string | null>(null);
  const [metaTestResults, setMetaTestResults] = useState<Record<string, MetaTestResult>>({});
  const [testingVturb, setTestingVturb] = useState(false);
  const [vturbTestResult, setVturbTestResult] = useState<{ ok: boolean; players?: VturbDetectedPlayer[]; error?: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !userId) navigate("/auth", { replace: true });
  }, [authLoading, navigate, userId]);

  useEffect(() => {
    if (
      routeClientId &&
      client?.id === routeClientId &&
      currentWorkspace?.id !== routeClientId
    ) {
      setCurrentWorkspaceId(routeClientId);
    }
  }, [
    client?.id,
    currentWorkspace?.id,
    routeClientId,
    setCurrentWorkspaceId,
  ]);

  const draftStorageKey = useMemo(
    () => `${SETUP_DRAFT_STORAGE_KEY}.${client?.id ?? "global"}`,
    [client?.id],
  );
  const currentStepIndex = STEPS.findIndex((item) => item.id === step);
  const canSubmit = name.trim().length >= 2;
  const selectedExistingMetaAccounts = existingMetaAccounts.filter((account) =>
    selectedExistingMetaIds.includes(account.id)
  );
  const selectedDiscoveredMetaAccounts = discoveredMetaAccounts.filter((account) =>
    selectedDiscoveredMetaIds.includes(account.accountId)
  );
  const metaDiscoveryIsStale =
    discoveredMetaAccounts.length > 0 && discoveredMetaToken !== metaToken.trim();
  const selectedMetaAccountKeys = selectedExistingMetaAccounts.map((account) => existingMetaTestKey(account.id));
  const metaAccountCount = new Set([
    ...selectedExistingMetaAccounts.map((account) => normalizeAccountId(account.account_id)),
    ...selectedDiscoveredMetaAccounts.map((account) => account.accountId),
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
  const metaStatus: SourceSetupStatus = skippedSources.includes("meta")
    ? "skipped"
    : hasMetaTestError || metaDiscoveryIsStale
      ? "error"
      : metaAccountCount > 0
        ? "configured"
        : "not_started";
  const vturbStatus: SourceSetupStatus = skippedSources.includes("vturb")
    ? "skipped"
    : vturbTestResult?.ok === false
      ? "error"
      : vturbKey.trim() && playerIds.length > 0
        ? "configured"
        : "not_started";
  const gatewayStatus: SourceSetupStatus = skippedSources.includes("gateway")
    ? "skipped"
    : hublaSecret.trim()
      ? "configured"
      : "not_started";
  const sourceStatuses: Record<SetupSource, SourceSetupStatus> = {
    meta: metaStatus,
    vturb: vturbStatus,
    gateway: gatewayStatus,
  };
  const allSourcesConfigured = Object.values(sourceStatuses).every(
    (status) => status === "configured",
  );
  const sourcesDecided = Object.values(sourceStatuses).every(
    (status) => status === "configured" || status === "skipped",
  );
  const stepCompletion: Record<StepId, boolean> = {
    nome: canSubmit,
    fontes: allSourcesConfigured,
    revisao: false,
  };

  function resumeSource(source: SetupSource) {
    setSkippedSources((current) => current.filter((item) => item !== source));
  }

  function skipSource(source: SetupSource) {
    setSkippedSources((current) => [...new Set([...current, source])]);
    if (source === "meta") {
      setSelectedExistingMetaIds([]);
      setMetaToken("");
      setDiscoveredMetaAccounts([]);
      setSelectedDiscoveredMetaIds([]);
      setDiscoveredMetaToken("");
      setMetaDiscoveryError(null);
      setMetaTestResults({});
    } else if (source === "vturb") {
      setVturbKey("");
      setPlayersText("");
      setVturbTestResult(null);
    } else {
      setHublaSecret("");
    }
  }

  function setPlayerIds(nextIds: string[]) {
    resumeSource("vturb");
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
    resumeSource("meta");
    setSelectedExistingMetaIds((current) =>
      checked
        ? [...new Set([...current, accountId])]
        : current.filter((id) => id !== accountId)
    );
  }

  function updateMetaToken(value: string) {
    resumeSource("meta");
    setMetaToken(value);
    if (value.trim() !== discoveredMetaToken) setDiscoveredMetaToken("");
    setMetaDiscoveryError(null);
  }

  function toggleDiscoveredMetaAccount(accountId: string, checked: boolean) {
    resumeSource("meta");
    setSelectedDiscoveredMetaIds((current) =>
      checked
        ? [...new Set([...current, accountId])]
        : current.filter((id) => id !== accountId)
    );
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

  async function discoverMetaAccounts() {
    const token = metaToken.trim();
    if (!client?.id || !token) return;
    setDiscoveringMetaAccounts(true);
    setMetaDiscoveryError(null);
    try {
      const { data, error } = await supabase.functions.invoke("meta-test", {
        body: {
          action: "list_accounts",
          workspace_id: client.id,
          access_token: token,
        },
      });
      const payload = data && typeof data === "object"
        ? data as { accounts?: unknown; error?: unknown }
        : {};
      const errorMessage = await metaInvokeErrorMessage(payload.error, error);
      if (errorMessage) throw new Error(errorMessage);

      const accounts = parseDiscoveredMetaAccounts(payload.accounts);
      setDiscoveredMetaAccounts(accounts);
      setDiscoveredMetaToken(token);
      const availableIds = new Set(accounts.map((account) => account.accountId));
      setSelectedDiscoveredMetaIds((current) => current.filter((id) => availableIds.has(id)));
      if (accounts.length === 0) {
        setMetaDiscoveryError("Nenhuma conta de anúncios foi encontrada para este token.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao buscar contas Meta";
      setMetaDiscoveryError(humanizeMetaDiscoveryError(message));
    } finally {
      setDiscoveringMetaAccounts(false);
    }
  }

  useEffect(() => {
    if (!client?.id) {
      setExistingMetaAccounts([]);
      return;
    }

    let cancelled = false;
    void supabase
      .from("workspace_meta_accounts")
      .select("id, account_id, label, last_synced_at")
      .eq("workspace_id", client.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Falha ao carregar contas Meta do cliente");
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
  }, [client?.id]);

  useEffect(() => {
    const draft = readSetupDraft(draftStorageKey) ?? emptySetupDraft();
    setStep(draft.step);
    setName(draft.name);
    setSelectedExistingMetaIds(draft.selectedExistingMetaIds);
    setMetaToken("");
    setDiscoveredMetaAccounts([]);
    setSelectedDiscoveredMetaIds([]);
    setDiscoveredMetaToken("");
    setVturbKey("");
    setPlayersText(draft.playersText);
    setHublaSecret("");
    setSkippedSources(draft.skippedSources);
    setMetaTestResults({});
    setVturbTestResult(null);
    setHydratedDraftKey(draftStorageKey);
  }, [draftStorageKey]);

  useEffect(() => {
    if (hydratedDraftKey !== draftStorageKey) return;

    const draft: SetupDraftV2 = {
      version: 2,
      step,
      name,
      selectedExistingMetaIds,
      playersText,
      skippedSources,
    };

    if (isSetupDraftEmpty(draft)) {
      sessionStorage.removeItem(draftStorageKey);
      return;
    }

    sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [
    draftStorageKey,
    hydratedDraftKey,
    name,
    playersText,
    selectedExistingMetaIds,
    skippedSources,
    step,
  ]);

  async function createOperation() {
    if (!user || !client?.id || !canSubmit) return;
    if (selectedDiscoveredMetaAccounts.length > 0 && !metaToken.trim()) {
      setStep("fontes");
      toast.error("Informe o token Meta para salvar as contas selecionadas.");
      return;
    }
    if (selectedDiscoveredMetaAccounts.length > 0 && metaDiscoveryIsStale) {
      setStep("fontes");
      toast.error("Busque as contas novamente após alterar o token Meta.");
      return;
    }

    let createdProjectId: string | null = null;
    const configuredSources: ActivationSource[] = [];
    setSaving(true);
    setSavingLabel("Criando a estrutura do funil");
    try {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          workspace_id: client.id,
          name: name.trim(),
          source: "api",
          csv_content: null,
        })
        .select("id")
        .single();
      if (projectError || !project) throw projectError ?? new Error("Falha ao criar projeto");
      createdProjectId = project.id;
      setSavingLabel("Vinculando suas fontes");

      const metaRowIds = new Set(selectedExistingMetaIds);
      for (const account of selectedDiscoveredMetaAccounts) {
        const { data: metaData, error: metaError } = await supabase.functions.invoke("workspace-credentials", {
          body: {
            action: "upsert_meta_account",
            workspace_id: client.id,
            account_id: account.accountId,
            access_token: metaToken.trim(),
            label: account.name || account.accountId,
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
        configuredSources.push("meta");
      }

      if (vturbKey.trim() || hublaSecret.trim()) {
        const integrationBody: Record<string, unknown> = {
          action: "upsert_workspace_integration",
          workspace_id: client.id,
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
              workspace_id: client.id,
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
        configuredSources.push("vturb");
      }

      if (hublaSecret.trim()) {
        const { error: checkoutError } = await supabase
          .from("project_checkout_bindings")
          .insert({
            project_id: project.id,
            enabled: true,
          });
        if (checkoutError) throw checkoutError;
        configuredSources.push("gateway");
      }

      const syncSources = configuredSources.filter(
        (source): source is ActivationSyncSource =>
          source === "meta" || source === "vturb",
      );

      setSavingLabel("Preparando seu primeiro resultado");
      sessionStorage.removeItem(draftStorageKey);
      saveFunnelActivationPlan({
        version: 1,
        projectId: project.id,
        workspaceId: client.id,
        configuredSources,
        skippedSources,
        syncSources,
        syncState: syncSources.length > 0 ? "pending" : "complete",
        createdAt: new Date().toISOString(),
      });
      navigate(`/funnels/${project.id}/activation`, { replace: true });
    } catch (error) {
      if (createdProjectId) {
        sessionStorage.removeItem(draftStorageKey);
        const syncSources = configuredSources.filter(
          (source): source is ActivationSyncSource =>
            source === "meta" || source === "vturb",
        );
        saveFunnelActivationPlan({
          version: 1,
          projectId: createdProjectId,
          workspaceId: client.id,
          configuredSources,
          skippedSources,
          syncSources,
          syncState: syncSources.length > 0 ? "pending" : "error",
          createdAt: new Date().toISOString(),
          setupError:
            error instanceof Error
              ? error.message
              : "Uma fonte não pôde ser concluída.",
        });
        toast.warning("O funil foi criado. Vamos concluir a ativação.");
        navigate(`/funnels/${createdProjectId}/activation`, { replace: true });
      } else {
        toast.error(error instanceof Error ? error.message : "Falha ao criar funil");
      }
    } finally {
      setSaving(false);
      setSavingLabel("Criar funil");
    }
  }

  if (authLoading || workspaceLoading) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!client) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-8 md:px-6">
        <div className="section-card py-12 text-center">
          <h1 className="text-xl font-semibold">Selecione um cliente</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Um funil precisa pertencer a um cliente.
          </p>
          <Button className="mt-5" onClick={() => navigate("/clients")}>
            Ver clientes
          </Button>
        </div>
      </main>
    );
  }

  if (saving) {
    return <SetupCreatingState label={savingLabel} />;
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate(client ? `/clients/${client.id}/funnels` : "/projects")
            }
            className="min-h-11 shrink-0 gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            Funis
          </Button>
          <div>
            <h1 className="text-2xl font-bold leading-8">Novo funil</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Dê um nome ao funil e conecte somente as fontes que quiser usar agora.
              O rascunho salva apenas dados não sensíveis.
            </p>
          </div>
      </header>

      <div className="section-card">
        <div className="mb-6 grid grid-cols-3 gap-2" aria-label="Etapas de criação do funil">
          {STEPS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStep(item.id)}
              disabled={
                item.id === "revisao" && (!canSubmit || !sourcesDecided)
              }
              aria-current={step === item.id ? "step" : undefined}
              className={cn(
                "min-h-11 rounded-lg border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                step === item.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/50",
                stepCompletion[item.id] && step !== item.id && "text-green-600",
              )}
            >
              {stepCompletion[item.id] && (
                <Check className="mr-1 inline h-3.5 w-3.5" />
              )}
              {item.label}
            </button>
          ))}
        </div>

        {step === "nome" && (
          <StepSection title="Nome do funil">
            <Label htmlFor="funnel-name">Nome</Label>
            <Input
              id="funnel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Perpétuo Denise"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Use um nome que sua equipe reconheça facilmente.
            </p>
          </StepSection>
        )}

        {step === "fontes" && (
          <StepSection title="Meta Ads">
            <SourceSetupHeader
              status={metaStatus}
              onSkip={() => skipSource("meta")}
              onResume={() => resumeSource("meta")}
            />
            {existingMetaAccounts.length > 0 && (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Contas já cadastradas no cliente</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedExistingMetaAccounts.length} de {existingMetaAccounts.length} selecionada(s)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resumeSource("meta");
                        setSelectedExistingMetaIds(existingMetaAccounts.map((account) => account.id));
                      }}
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
              <div>
                <div>
                  <div className="text-sm font-medium">
                    {existingMetaAccounts.length > 0 ? "Buscar outras contas" : "Conectar contas Meta"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Cole o token uma única vez. Vamos listar todas as contas de anúncios disponíveis para você escolher.
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="Access token Meta" htmlFor="meta-shared-token">
                    <Input
                      id="meta-shared-token"
                      value={metaToken}
                      onChange={(event) => updateMetaToken(event.target.value)}
                      type="password"
                      placeholder="Cole o token Meta uma única vez"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!metaToken.trim() || discoveringMetaAccounts}
                  onClick={discoverMetaAccounts}
                  className="shrink-0 gap-2"
                >
                  {discoveringMetaAccounts
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Search className="h-4 w-4" />}
                  Buscar contas
                </Button>
              </div>

              {metaDiscoveryError && <p className="text-xs text-red-600">{metaDiscoveryError}</p>}
              {metaDiscoveryIsStale && (
                <p className="text-xs text-amber-600">
                  O token foi alterado. Suas contas continuam marcadas; busque novamente para validar o novo token.
                </p>
              )}

              {discoveredMetaAccounts.length > 0 && (
                <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Contas encontradas</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedDiscoveredMetaAccounts.length} de {discoveredMetaAccounts.length} selecionada(s)
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedDiscoveredMetaIds(discoveredMetaAccounts.map((account) => account.accountId))}
                      >
                        Selecionar todas
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedDiscoveredMetaIds([])}>
                        Limpar
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {discoveredMetaAccounts.map((account) => (
                      <label
                        key={account.accountId}
                        className="flex cursor-pointer items-start gap-3 rounded-md border border-border/40 bg-background/50 p-3"
                      >
                        <Checkbox
                          checked={selectedDiscoveredMetaIds.includes(account.accountId)}
                          onCheckedChange={(checked) => toggleDiscoveredMetaAccount(account.accountId, checked === true)}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{account.name || account.accountId}</div>
                          <div className="break-all font-mono text-xs text-muted-foreground">{account.accountId}</div>
                          <div className={cn(
                            "mt-1 text-[11px]",
                            metaDiscoveryIsStale ? "text-amber-600" : "text-green-600",
                          )}>
                            {metaDiscoveryIsStale ? "Aguardando validação do novo token" : "Acesso confirmado"}
                            {account.currency ? ` · ${account.currency}` : ""}
                            {account.timezone ? ` · ${account.timezone}` : ""}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </StepSection>
        )}

        {step === "fontes" && (
          <StepSection title="VTurb">
            <SourceSetupHeader
              status={vturbStatus}
              onSkip={() => skipSource("vturb")}
              onResume={() => resumeSource("vturb")}
            />
            <Field label="API key" htmlFor="vturb-api-key">
              <Input
                id="vturb-api-key"
                value={vturbKey}
                onChange={(event) => {
                  resumeSource("vturb");
                  setVturbKey(event.target.value);
                }}
                type="password"
                placeholder="Cole a API key da VTurb"
                autoComplete="off"
              />
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
                    <div className="text-sm font-medium">Selecione os vídeos deste funil</div>
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
            <Field label="Players selecionados ou IDs manuais" htmlFor="vturb-player-ids">
              <Textarea
                id="vturb-player-ids"
                value={playersText}
                onChange={(event) => {
                  resumeSource("vturb");
                  setPlayersText(event.target.value);
                }}
                placeholder="Selecione acima ou cole um player ID por linha"
                rows={5}
              />
            </Field>
          </StepSection>
        )}

        {step === "fontes" && (
          <StepSection title="Gateway de pagamento">
            <SourceSetupHeader
              status={gatewayStatus}
              onSkip={() => skipSource("gateway")}
              onResume={() => resumeSource("gateway")}
            />
            <Field label="Token/secret do webhook" htmlFor="gateway-secret">
              <Input
                id="gateway-secret"
                value={hublaSecret}
                onChange={(event) => {
                  resumeSource("gateway");
                  setHublaSecret(event.target.value);
                }}
                type="password"
                placeholder="Cole o secret da Hubla"
                autoComplete="off"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              O webhook será criado e poderá ser copiado somente depois que o funil
              estiver persistido.
            </p>
          </StepSection>
        )}

        {step === "fontes" && !sourcesDecided && (
          <p className="mt-6 text-xs text-muted-foreground">
            Configure cada fonte ou escolha “Fazer depois” para avançar.
          </p>
        )}

        {step === "revisao" && (
          <StepSection title="Revisão">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Review
                label="Funil"
                value={name || "Nome pendente"}
                status={canSubmit ? "configured" : "not_started"}
              />
              <Review
                label="Meta"
                value={
                  metaAccountCount > 0
                    ? `${metaAccountCount} conta(s) selecionada(s)`
                    : sourceStatusDescription(metaStatus)
                }
                status={metaStatus}
                detail={allSelectedMetaAccountsTested ? "Contas selecionadas testadas" : undefined}
              />
              <Review
                label="VTurb"
                value={
                  playerIds.length > 0
                    ? `${playerIds.length} player(s) selecionado(s)`
                    : sourceStatusDescription(vturbStatus)
                }
                status={vturbStatus}
                detail={vturbTestResult?.ok ? "API validada" : undefined}
              />
              <Review
                label="Gateway"
                value={
                  hublaSecret.trim()
                    ? "Secret configurado"
                    : sourceStatusDescription(gatewayStatus)
                }
                status={gatewayStatus}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Depois de criar, você acompanhará a ativação do funil e verá o primeiro
              sinal real encontrado. Fontes adiadas continuam como uma escolha neutra.
            </p>
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
          {step === "revisao" ? (
            <Button type="button" disabled={!canSubmit || saving} onClick={createOperation} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {saving ? savingLabel : "Criar funil"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                (step === "nome" && !canSubmit) ||
                (step === "fontes" && !sourcesDecided) ||
                saving
              }
              onClick={() =>
                setStep(STEPS[Math.min(STEPS.length - 1, currentStepIndex + 1)].id)
              }
            >
              Próximo
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

function SetupCreatingState({ label }: { label: string }) {
  const stages = [
    { label: "Criar estrutura", icon: Waypoints },
    { label: "Vincular fontes", icon: Plug },
    { label: "Preparar sinais", icon: Database },
  ];
  const activeIndex = label.includes("estrutura")
    ? 0
    : label.includes("Vinculando")
      ? 1
      : 2;

  return (
    <main
      className="page-shell flex min-h-[calc(100vh-56px)] items-center justify-center"
      aria-busy="true"
      aria-labelledby="setup-creating-title"
    >
      <section className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-primary/20 bg-card/90 p-6 text-center shadow-[0_24px_80px_-40px_hsl(var(--primary)/0.55)] md:p-10">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/10 to-transparent"
          aria-hidden="true"
        />
        <div className="relative">
          <div className="relative mx-auto flex h-36 w-36 items-center justify-center" aria-hidden="true">
            <span className="absolute inset-0 animate-[spin_8s_linear_infinite] rounded-full border border-primary/20 border-r-primary/80 motion-reduce:animate-none" />
            <span className="absolute inset-5 animate-[spin_5s_linear_infinite_reverse] rounded-full border border-accent/20 border-l-accent/70 motion-reduce:animate-none" />
            <span className="absolute inset-10 rounded-full bg-primary/10 shadow-[0_0_44px_-14px_hsl(var(--primary))]" />
            <Radio className="relative h-9 w-9 animate-pulse text-primary motion-reduce:animate-none" />
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Tudo certo até aqui
          </p>
          <h1 id="setup-creating-title" className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
            {label}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            Estamos salvando o funil com segurança. Em seguida você verá o primeiro
            resultado ou o próximo passo mais útil.
          </p>

          <ol className="mx-auto mt-8 grid max-w-lg gap-3 text-left sm:grid-cols-3">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              const done = index < activeIndex;
              const active = index === activeIndex;
              return (
                <li
                  key={stage.label}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-xl border p-3 sm:flex-col sm:items-start",
                    active
                      ? "border-primary/35 bg-primary/10"
                      : done
                        ? "border-primary/20 bg-primary/5"
                        : "border-border/60 bg-background/25",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg",
                      done || active
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <Check className="h-4 w-4" />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </span>
                  <span className="text-xs font-medium">{stage.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </main>
  );
}

function StepSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 [&+&]:mt-8 [&+&]:border-t [&+&]:border-border/50 [&+&]:pt-8">
      <h2 className="text-lg font-semibold leading-7">{title}</h2>
      {children}
    </section>
  );
}

function SourceSetupHeader({
  status,
  onSkip,
  onResume,
}: {
  status: SourceSetupStatus;
  onSkip: () => void;
  onResume: () => void;
}) {
  const skipped = status === "skipped";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between">
      <SourceStatus status={status} />
      <Button
        type="button"
        variant={skipped ? "outline" : "ghost"}
        size="sm"
        onClick={skipped ? onResume : onSkip}
      >
        {skipped ? "Configurar agora" : "Fazer depois"}
      </Button>
    </div>
  );
}

function SourceStatus({ status }: { status: SourceSetupStatus }) {
  const config = {
    not_started: {
      label: "Ainda não configurado",
      icon: Circle,
      className: "text-muted-foreground",
    },
    configured: {
      label: "Configurado",
      icon: CircleCheck,
      className: "text-green-600",
    },
    skipped: {
      label: "Adiado para depois",
      icon: Clock3,
      className: "text-muted-foreground",
    },
    error: {
      label: "Precisa de atenção",
      icon: CircleAlert,
      className: "text-red-600",
    },
  } satisfies Record<
    SourceSetupStatus,
    { label: string; icon: typeof Circle; className: string }
  >;
  const current = config[status];
  const Icon = current.icon;

  return (
    <span className={cn("mt-1 flex items-center gap-1.5 text-xs", current.className)}>
      <Icon className="h-3.5 w-3.5" />
      {current.label}
    </span>
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

function Review({ label, value, status, detail }: {
  label: string;
  value: string;
  status: SourceSetupStatus;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium mt-1">{value}</div>
      <SourceStatus status={status} />
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function sourceStatusDescription(status: SourceSetupStatus) {
  if (status === "skipped") return "Fazer depois";
  if (status === "error") return "Precisa de atenção";
  if (status === "configured") return "Configurado";
  return "Ainda não configurado";
}

function normalizeAccountId(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function existingMetaTestKey(accountId: string) {
  return `existing:${accountId}`;
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

function parseDiscoveredMetaAccounts(value: unknown): DiscoveredMetaAccount[] {
  if (!Array.isArray(value)) return [];
  const accounts = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const account = entry as Record<string, unknown>;
    const rawId = typeof account.account_id === "string"
      ? account.account_id
      : typeof account.id === "string" ? account.id : "";
    if (!rawId.trim()) return [];
    return [{
      accountId: normalizeAccountId(rawId),
      name: typeof account.name === "string" ? account.name : null,
      accountStatus: typeof account.account_status === "number" ? account.account_status : null,
      currency: typeof account.currency === "string" ? account.currency : null,
      timezone: typeof account.timezone === "string"
        ? account.timezone
        : typeof account.timezone_name === "string" ? account.timezone_name : null,
    } satisfies DiscoveredMetaAccount];
  });
  return [...new Map(accounts.map((account) => [account.accountId, account])).values()];
}

function readSetupDraft(storageKey: string) {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      version: 2,
      step: readStepId(parsed.step),
      name: typeof parsed.name === "string" ? parsed.name : "",
      selectedExistingMetaIds: readStringArray(parsed.selectedExistingMetaIds),
      playersText: typeof parsed.playersText === "string" ? parsed.playersText : "",
      skippedSources: readStringArray(parsed.skippedSources).filter(isSetupSource),
    } satisfies SetupDraftV2;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())))]
    : [];
}

async function metaInvokeErrorMessage(payloadError: unknown, invokeError: unknown) {
  if (typeof payloadError === "string" && payloadError.trim()) return payloadError.trim();

  const context = invokeError && typeof invokeError === "object"
    ? (invokeError as { context?: unknown }).context
    : null;
  if (typeof Response !== "undefined" && context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // The generic invoke error below is still preferable to hiding the failure.
    }
  }

  return invokeError instanceof Error && invokeError.message.trim()
    ? invokeError.message.trim()
    : null;
}

function humanizeMetaDiscoveryError(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("access token") ||
    normalized.includes("oauth") ||
    normalized.includes("session has expired") ||
    normalized.includes("token de acesso")
  ) {
    return "A Meta não aceitou este token. Confirme se ele está válido e possui a permissão ads_read.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("jwt")) {
    return "Sua sessão expirou. Entre novamente antes de buscar as contas Meta.";
  }
  return message;
}

function readStepId(value: unknown): StepId {
  if (value === "fontes" || value === "meta" || value === "vturb" || value === "hubla") {
    return "fontes";
  }
  if (value === "revisao" || value === "final") return "revisao";
  return "nome";
}

function isSetupSource(value: string): value is SetupSource {
  return value === "meta" || value === "vturb" || value === "gateway";
}

function isSetupDraftEmpty(draft: SetupDraftV2) {
  return (
    draft.step === "nome" &&
    !draft.name.trim() &&
    draft.selectedExistingMetaIds.length === 0 &&
    !draft.playersText.trim() &&
    draft.skippedSources.length === 0
  );
}

function emptySetupDraft(): SetupDraftV2 {
  return {
    version: 2,
    step: "nome",
    name: "",
    selectedExistingMetaIds: [],
    playersText: "",
    skippedSources: [],
  };
}

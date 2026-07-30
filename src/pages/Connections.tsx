import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  CreditCard,
  Database,
  Link as LinkIcon,
  Loader2,
  Megaphone,
  PlayCircle,
  Radio,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { HublaImportDialog } from "@/components/hubla/HublaImportDialog";
import { HotmartImportDialog } from "@/components/checkout/HotmartImportDialog";
import { HotmartProductBindings } from "@/components/checkout/HotmartProductBindings";
import { HotmartBackfillDialog } from "@/components/checkout/HotmartBackfillDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  type CheckoutProductBinding,
  type WorkspaceCheckoutBindingSafeRow,
  type WorkspaceCheckoutCatalogSafeRow,
  type WorkspaceCheckoutIntegrationSafeRow,
  getFunnelCheckoutBindingSafe,
  listWorkspaceCheckoutCatalogSafe,
  listWorkspaceCheckoutIntegrationsSafe,
  listWorkspaceMetaAccountsSafe,
} from "@/lib/operationalReadApi";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";
import { getProjectMetaBindingChanges } from "@/lib/projectMetaBindings";
import { cn } from "@/lib/utils";
import { trackProductEvent } from "@/lib/productEvents";
import { publicConfig } from "@/lib/publicConfig";

type ConnectionsMode = "sources" | "sharing";

interface ProjectRow {
  id: string;
  name: string;
  workspace_id: string;
}

interface MetaAccountRow {
  id: string;
  account_id: string;
  label: string | null;
}

interface VturbPlayerRow {
  id: string;
  player_id: string;
  label: string | null;
}

interface PublicLinkRow {
  id: string;
  token: string;
  enabled: boolean;
  label: string | null;
  last_accessed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function Connections({ mode = "sources" }: { mode?: ConnectionsMode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { funnelId } = useParams<{ funnelId?: string }>();
  const projectId = funnelId ?? searchParams.get("project");
  const { user, loading: authLoading } = useAuth();
  const { currentWorkspace, isWorkspaceAdmin, setCurrentWorkspaceId } = useWorkspace();

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccountRow[]>([]);
  const [selectedMetaIds, setSelectedMetaIds] = useState<string[]>([]);
  const [savedMetaIds, setSavedMetaIds] = useState<string[]>([]);
  const metaSelectionRef = useRef({ selected: [] as string[], saved: [] as string[] });
  const [vturbPlayers, setVturbPlayers] = useState<VturbPlayerRow[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [savedPlayerIds, setSavedPlayerIds] = useState<string[]>([]);
  const [playerQuery, setPlayerQuery] = useState("");
  const [checkoutIntegrations, setCheckoutIntegrations] = useState<
    WorkspaceCheckoutIntegrationSafeRow[]
  >([]);
  const [checkoutCatalog, setCheckoutCatalog] = useState<
    WorkspaceCheckoutCatalogSafeRow[]
  >([]);
  const [checkoutBinding, setCheckoutBinding] =
    useState<WorkspaceCheckoutBindingSafeRow | null>(null);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [savedCheckoutEnabled, setSavedCheckoutEnabled] = useState(false);
  const [checkoutIntegrationId, setCheckoutIntegrationId] = useState("");
  const [savedCheckoutIntegrationId, setSavedCheckoutIntegrationId] =
    useState("");
  const [checkoutProducts, setCheckoutProducts] = useState<
    CheckoutProductBinding[]
  >([]);
  const [savedCheckoutProducts, setSavedCheckoutProducts] = useState<
    CheckoutProductBinding[]
  >([]);
  const [publicLinks, setPublicLinks] = useState<PublicLinkRow[]>([]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, navigate, user]);

  const load = useCallback(async (showLoading = true) => {
    if (!projectId) return;
    if (showLoading) setState("loading");
    setLoadError("");

    try {
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("id, name, workspace_id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError || !projectData) throw projectError ?? new Error("Funil não encontrado.");

      const typedProject = projectData as ProjectRow;
      setProject(typedProject);
      if (typedProject.workspace_id !== currentWorkspace?.id) {
        setCurrentWorkspaceId(typedProject.workspace_id);
      }

      const [
        metaResult,
        selectedMetaResult,
        playerResult,
        selectedPlayerResult,
        checkoutResult,
        checkoutIntegrationsResult,
        checkoutCatalogResult,
        linkResult,
      ] = await Promise.all([
        listWorkspaceMetaAccountsSafe(typedProject.workspace_id),
        supabase.from("project_meta_accounts").select("meta_account_id").eq("project_id", typedProject.id),
        supabase
          .from("workspace_vturb_players")
          .select("id, player_id, label")
          .eq("workspace_id", typedProject.workspace_id)
          .order("created_at", { ascending: true }),
        supabase.from("project_vturb_players").select("vturb_player_id").eq("project_id", typedProject.id),
        getFunnelCheckoutBindingSafe(typedProject.id),
        listWorkspaceCheckoutIntegrationsSafe(typedProject.workspace_id),
        listWorkspaceCheckoutCatalogSafe(typedProject.workspace_id),
        supabase
          .from("project_public_links" as never)
          .select("id, token, enabled, label, last_accessed_at, expires_at, created_at")
          .eq("project_id", typedProject.id)
          .order("created_at", { ascending: false }),
      ]);

      const firstError = [
        selectedMetaResult.error,
        playerResult.error,
        selectedPlayerResult.error,
        linkResult.error,
      ].find(Boolean);
      if (firstError) throw firstError;

      const nextMetaIds = (selectedMetaResult.data ?? []).map((row) => row.meta_account_id);
      const hasPendingMetaChange =
        metaSelectionRef.current.selected.length !== metaSelectionRef.current.saved.length ||
        metaSelectionRef.current.selected.some((id) => !metaSelectionRef.current.saved.includes(id));
      if (!hasPendingMetaChange) {
        metaSelectionRef.current = { selected: nextMetaIds, saved: nextMetaIds };
        setSelectedMetaIds(nextMetaIds);
        setSavedMetaIds(nextMetaIds);
      }

      const nextPlayerIds = (selectedPlayerResult.data ?? []).map((row) => row.vturb_player_id);
      const typedCheckout = checkoutResult;
      const nextCheckoutProducts = typedCheckout?.product_bindings ?? [];
      setMetaAccounts(metaResult as MetaAccountRow[]);
      setVturbPlayers((playerResult.data ?? []) as VturbPlayerRow[]);
      setSelectedPlayerIds(nextPlayerIds);
      setSavedPlayerIds(nextPlayerIds);
      setCheckoutBinding(typedCheckout);
      setCheckoutIntegrations(checkoutIntegrationsResult);
      setCheckoutCatalog(checkoutCatalogResult);
      setCheckoutEnabled(typedCheckout?.enabled ?? false);
      setSavedCheckoutEnabled(typedCheckout?.enabled ?? false);
      setCheckoutIntegrationId(typedCheckout?.checkout_integration_id ?? "");
      setSavedCheckoutIntegrationId(
        typedCheckout?.checkout_integration_id ?? "",
      );
      setCheckoutProducts(nextCheckoutProducts);
      setSavedCheckoutProducts(nextCheckoutProducts);
      setPublicLinks((linkResult.data ?? []) as unknown as PublicLinkRow[]);
      setState("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar esta tela.");
      setState("error");
    }
  }, [currentWorkspace?.id, projectId, setCurrentWorkspaceId]);

  useEffect(() => {
    if (user && projectId) void load();
  }, [load, projectId, user]);

  const persistMetaBindings = async () => {
    if (!project) return;
    const { nextIds, idsToAdd, idsToRemove } = getProjectMetaBindingChanges(
      selectedMetaIds,
      savedMetaIds,
    );

    if (idsToAdd.length > 0) {
      const { error } = await supabase.from("project_meta_accounts").upsert(
        idsToAdd.map((metaAccountId) => ({
          project_id: project.id,
          meta_account_id: metaAccountId,
        })),
        { onConflict: "project_id,meta_account_id" },
      );
      if (error) throw error;
    }
    if (idsToRemove.length > 0) {
      const { error } = await supabase
        .from("project_meta_accounts")
        .delete()
        .eq("project_id", project.id)
        .in("meta_account_id", idsToRemove);
      if (error) throw error;
    }
    metaSelectionRef.current.saved = nextIds;
  };

  const saveSources = async () => {
    if (!project || !isWorkspaceAdmin) return;
    const selectedCheckout = checkoutIntegrations.find(
      (item) => item.id === checkoutIntegrationId,
    );
    if (checkoutEnabled && !selectedCheckout) {
      setSaveError("Selecione uma integração de checkout para este funil.");
      return;
    }
    if (
      checkoutEnabled
      && selectedCheckout?.provider === "hotmart"
      && checkoutProducts.filter((item) => item.role === "front").length !== 1
    ) {
      setSaveError("Selecione exatamente um produto front da Hotmart.");
      return;
    }
    setSaving(true);
    setSaveError("");
    let backfillWarning: string | null = null;
    try {
      await persistMetaBindings();

      const { error: deleteError } = await supabase
        .from("project_vturb_players")
        .delete()
        .eq("project_id", project.id);
      if (deleteError) throw deleteError;

      if (selectedPlayerIds.length > 0) {
        const { error } = await supabase.from("project_vturb_players").insert(
          selectedPlayerIds.map((vturbPlayerId) => ({
            project_id: project.id,
            vturb_player_id: vturbPlayerId,
          })),
        );
        if (error) throw error;
      }

      const shouldStartHotmartBackfill =
        checkoutEnabled
        && selectedCheckout?.provider === "hotmart"
        && (
          !checkoutBinding?.enabled
          || checkoutBinding.checkout_integration_id !== checkoutIntegrationId
        );
      if (checkoutBinding || checkoutEnabled) {
        const { data, error } = await supabase.functions.invoke(
          "workspace-credentials",
          {
            body: {
              action: "upsert_checkout_binding",
              workspace_id: project.workspace_id,
              project_id: project.id,
              enabled: checkoutEnabled,
              checkout_integration_id:
                checkoutIntegrationId || checkoutBinding?.checkout_integration_id,
              product_bindings:
                selectedCheckout?.provider === "hotmart"
                  ? checkoutProducts
                  : [],
            },
          },
        );
        if (error) {
          throw new Error(
            await edgeFunctionErrorMessage(
              error,
              "Não foi possível salvar o checkout do funil.",
            ),
          );
        }
        if (data?.ok === false) throw new Error(data.error);
        const savedBinding = data?.checkout_binding as
          | WorkspaceCheckoutBindingSafeRow
          | undefined;
        if (savedBinding) {
          setCheckoutBinding({
            ...savedBinding,
            provider: selectedCheckout?.provider ?? null,
            integration_label: selectedCheckout?.label ?? null,
            integration_status: selectedCheckout?.status ?? null,
            product_bindings: [...checkoutProducts],
          });
        }

        if (shouldStartHotmartBackfill && checkoutIntegrationId) {
          const { data: backfillData, error: backfillError } =
            await supabase.functions.invoke("hotmart-sync", {
              body: {
                action: "enqueue_backfill",
                workspace_id: project.workspace_id,
                project_id: project.id,
                integration_id: checkoutIntegrationId,
              },
            });
          if (backfillError) {
            backfillWarning = await edgeFunctionErrorMessage(
              backfillError,
              "O histórico Hotmart não foi iniciado.",
            );
          } else if (backfillData?.ok === false) {
            backfillWarning =
              backfillData.error ?? "O histórico Hotmart não foi iniciado.";
          } else {
            toast.success("Hotmart vinculada. Importação de 90 dias iniciada.");
          }
        }
      }

      setSavedMetaIds([...selectedMetaIds]);
      setSavedPlayerIds([...selectedPlayerIds]);
      setSavedCheckoutEnabled(checkoutEnabled);
      setSavedCheckoutIntegrationId(checkoutIntegrationId);
      setSavedCheckoutProducts([...checkoutProducts]);
      if (backfillWarning) {
        setSaveError(
          `As fontes foram salvas, mas o histórico precisa de atenção: ${backfillWarning}`,
        );
        toast.warning("Checkout salvo; tente o histórico novamente em Saúde.");
      } else if (!shouldStartHotmartBackfill) {
        toast.success("Fontes do funil salvas");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar as fontes.");
    } finally {
      setSaving(false);
    }
  };

  const createPublicLink = async () => {
    if (!project || !user || !isWorkspaceAdmin) return;
    setSaveError("");
    try {
      const token = crypto
        .getRandomValues(new Uint8Array(24))
        .reduce((value, byte) => value + byte.toString(16).padStart(2, "0"), "");
      const { error } = await supabase.from("project_public_links" as never).insert({
        project_id: project.id,
        token,
        enabled: true,
        label: "Acesso do cliente",
        created_by: user.id,
      } as never);
      if (error) throw error;
      trackProductEvent({
        eventName: "share_created",
        workspaceId: project.workspace_id,
        projectId: project.id,
        properties: { has_expiration: false },
      });
      toast.success("Link público criado");
      await load(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível criar o link.");
    }
  };

  const updatePublicLink = async (link: PublicLinkRow, enabled: boolean) => {
    setSaveError("");
    const { error } = await supabase
      .from("project_public_links" as never)
      .update({ enabled } as never)
      .eq("id", link.id);
    if (error) {
      setSaveError(error.message);
      return;
    }
    toast.success(enabled ? "Link reativado" : "Link desativado");
    await load(false);
  };

  const revokePublicLink = async (link: PublicLinkRow) => {
    setSaveError("");
    const { error } = await supabase.from("project_public_links" as never).delete().eq("id", link.id);
    if (error) {
      setSaveError(error.message);
      return;
    }
    toast.success("Link revogado");
    await load(false);
  };

  const visiblePlayers = useMemo(() => {
    const query = playerQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return vturbPlayers;
    return vturbPlayers.filter((player) =>
      `${player.label ?? ""} ${player.player_id}`.toLocaleLowerCase("pt-BR").includes(query),
    );
  }, [playerQuery, vturbPlayers]);

  const selectedCheckoutIntegration = useMemo(
    () =>
      checkoutIntegrations.find(
        (item) => item.id === checkoutIntegrationId,
      ) ?? null,
    [checkoutIntegrationId, checkoutIntegrations],
  );
  const selectedCheckoutCatalog = useMemo(
    () =>
      checkoutCatalog.filter(
        (item) => item.integration_id === checkoutIntegrationId,
      ),
    [checkoutCatalog, checkoutIntegrationId],
  );
  const checkoutConfigurationDirty =
    checkoutIntegrationId !== savedCheckoutIntegrationId ||
    checkoutProductFingerprint(checkoutProducts) !==
      checkoutProductFingerprint(savedCheckoutProducts) ||
    checkoutEnabled !== savedCheckoutEnabled;

  const isDirty =
    selectedMetaIds.length !== savedMetaIds.length ||
    selectedMetaIds.some((id) => !savedMetaIds.includes(id)) ||
    selectedPlayerIds.length !== savedPlayerIds.length ||
    selectedPlayerIds.some((id) => !savedPlayerIds.includes(id)) ||
    checkoutConfigurationDirty;

  if (!projectId) return <Navigate to="/clients" replace />;

  if (authLoading || state === "loading") {
    return (
      <main className="flex min-h-[calc(100vh-80px)] items-center justify-center" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Carregando</span>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="mx-auto max-w-[760px] px-4 py-12 md:px-6 lg:px-8">
        <InlineError message={loadError} onRetry={() => void load()} />
      </main>
    );
  }

  const backToFunnels = project ? `/clients/${project.workspace_id}/funnels` : "/clients";
  const returnTo = mode === "sharing" ? `/funnels/${projectId}/sharing` : `/funnels/${projectId}/sources`;
  const integrationsPath = project
    ? `/clients/${project.workspace_id}/integrations?returnTo=${encodeURIComponent(returnTo)}`
    : "/clients";
  const gatewayWebhookUrl =
    selectedCheckoutIntegration?.provider && checkoutBinding?.webhook_token
      ? `${SUPABASE_URL}/functions/v1/webhook-gateway/${selectedCheckoutIntegration.provider}/${checkoutBinding.webhook_token}`
      : null;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => navigate(backToFunnels)}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Voltar para funis</span>
          </Button>
          <div>
            <h1 className="text-2xl font-bold leading-8">
              {mode === "sharing" ? "Compartilhamento" : funnelId ? "Fontes de dados" : "Conexões · Fontes de dados"}
            </h1>
            <p className="text-sm leading-5 text-muted-foreground">
              {project?.name} ·{" "}
              {mode === "sharing"
                ? "links públicos deste funil"
                : "recursos do cliente vinculados a este funil"}
            </p>
          </div>
        </div>
        {mode === "sharing" && isWorkspaceAdmin ? (
          <Button onClick={createPublicLink} className="min-h-11 gap-2">
            <LinkIcon className="h-4 w-4" />
            Criar link público
          </Button>
        ) : mode === "sources" && isWorkspaceAdmin ? (
          <Button variant="outline" onClick={() => navigate(integrationsPath)} className="min-h-11 gap-2">
            <Settings2 className="h-4 w-4" />
            Integrações do cliente
          </Button>
        ) : null}
      </header>

      {saveError && <InlineError message={saveError} className="mb-6" />}

      {mode === "sources" ? (
        <div className="space-y-6">
          <SourceSection
            icon={<Megaphone className="h-5 w-5" />}
            title="Meta Ads"
            description="Selecione as contas cadastradas no cliente."
            connected={selectedMetaIds.length > 0}
          >
            {metaAccounts.length === 0 ? (
              <MissingResource
                message="Este cliente ainda não possui contas Meta disponíveis."
                onAdd={isWorkspaceAdmin ? () => navigate(integrationsPath) : undefined}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {metaAccounts.map((account) => (
                  <ResourceCheckbox
                    key={account.id}
                    checked={selectedMetaIds.includes(account.id)}
                    disabled={!isWorkspaceAdmin}
                    label={account.label || account.account_id}
                    detail={account.account_id}
                    onCheckedChange={(checked) => {
                      setSelectedMetaIds((current) => {
                        const next = checked
                          ? Array.from(new Set([...current, account.id]))
                          : current.filter((id) => id !== account.id);
                        metaSelectionRef.current.selected = next;
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </SourceSection>

          <SourceSection
            icon={<PlayCircle className="h-5 w-5" />}
            title="VTurb"
            description="Selecione os players cadastrados no cliente."
            connected={selectedPlayerIds.length > 0}
          >
            {vturbPlayers.length === 0 ? (
              <MissingResource
                message="Este cliente ainda não possui players VTurb disponíveis."
                onAdd={isWorkspaceAdmin ? () => navigate(integrationsPath) : undefined}
              />
            ) : (
              <div className="space-y-4">
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={playerQuery}
                    onChange={(event) => setPlayerQuery(event.target.value)}
                    placeholder="Filtrar por nome ou ID do player"
                    className="min-h-11 pl-9"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {visiblePlayers.map((player) => (
                    <ResourceCheckbox
                      key={player.id}
                      checked={selectedPlayerIds.includes(player.id)}
                      disabled={!isWorkspaceAdmin}
                      label={player.label || player.player_id}
                      detail={player.player_id}
                      onCheckedChange={(checked) =>
                        setSelectedPlayerIds((current) =>
                          checked
                            ? Array.from(new Set([...current, player.id]))
                            : current.filter((id) => id !== player.id),
                        )
                      }
                    />
                  ))}
                </div>
                {visiblePlayers.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum player corresponde à busca.</p>
                )}
              </div>
            )}
          </SourceSection>

          <SourceSection
            icon={<CreditCard className="h-5 w-5" />}
            title="Checkout"
            description="Escolha a integração e os produtos que pertencem a este funil."
            connected={Boolean(checkoutBinding?.enabled)}
          >
            <div className="space-y-4">
              {checkoutIntegrations.length === 0 ? (
                <MissingResource
                  message="Conecte Hubla ou Hotmart no Cliente antes de vincular este funil."
                  onAdd={isWorkspaceAdmin ? () => navigate(integrationsPath) : undefined}
                />
              ) : (
                <>
                  <div className="max-w-xl space-y-2">
                    <label
                      htmlFor="checkout-integration"
                      className="text-sm font-medium"
                    >
                      Integração de checkout
                    </label>
                    <Select
                      value={checkoutIntegrationId}
                      disabled={!isWorkspaceAdmin}
                      onValueChange={(value) => {
                        setCheckoutIntegrationId(value);
                        setCheckoutEnabled(true);
                        setCheckoutProducts(
                          value === savedCheckoutIntegrationId
                            ? [...savedCheckoutProducts]
                            : [],
                        );
                      }}
                    >
                      <SelectTrigger
                        id="checkout-integration"
                        className="min-h-11"
                      >
                        <SelectValue placeholder="Selecione Hubla ou Hotmart" />
                      </SelectTrigger>
                      <SelectContent>
                        {checkoutIntegrations.map((item) => (
                          <SelectItem
                            key={item.id}
                            value={item.id}
                            disabled={item.status !== "connected"}
                          >
                            {item.label} · {providerName(item.provider)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedCheckoutIntegration ? (
                      <p className="text-xs text-muted-foreground">
                        {selectedCheckoutIntegration.provider === "hotmart"
                        && selectedCheckoutIntegration.status === "connected"
                        && !selectedCheckoutIntegration.has_webhook_secret
                          ? "API conectada para catálogo e histórico. Falta configurar o Hottok para receber vendas novas."
                          : selectedCheckoutIntegration.status === "connected"
                            ? "Conta conectada e pronta para o funil."
                            : "Esta conexão ainda requer atenção nas Integrações do Cliente."}
                      </p>
                    ) : null}
                  </div>

                  {checkoutIntegrationId ? (
                    <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                      <Checkbox
                        checked={checkoutEnabled}
                        onCheckedChange={(checked) =>
                          setCheckoutEnabled(checked === true)
                        }
                        disabled={!isWorkspaceAdmin}
                      />
                      Usar {selectedCheckoutIntegration?.label ?? "checkout"} neste
                      funil
                    </label>
                  ) : null}

                  {checkoutEnabled
                  && selectedCheckoutIntegration?.provider === "hotmart" ? (
                    <HotmartDataFlow
                      hasHottok={
                        selectedCheckoutIntegration.has_webhook_secret
                      }
                    />
                  ) : null}

                  {checkoutEnabled
                    && selectedCheckoutIntegration?.provider === "hotmart" ? (
                      selectedCheckoutCatalog.length === 0 ? (
                        <MissingResource
                          message="O catálogo Hotmart ainda não possui produtos. Atualize-o nas integrações do cliente."
                          onAdd={
                            isWorkspaceAdmin
                              ? () => navigate(integrationsPath)
                              : undefined
                          }
                        />
                      ) : (
                        <HotmartProductBindings
                          catalog={selectedCheckoutCatalog}
                          value={checkoutProducts}
                          disabled={!isWorkspaceAdmin}
                          onChange={setCheckoutProducts}
                        />
                      )
                    ) : null}

                  {checkoutEnabled
                  && checkoutBinding
                  && checkoutBinding.checkout_integration_id
                    === checkoutIntegrationId
                  && !checkoutConfigurationDirty
                  && isWorkspaceAdmin ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                      {selectedCheckoutIntegration?.provider === "hotmart" ? (
                        <HotmartWebhookGuide
                          hasHottok={
                            selectedCheckoutIntegration.has_webhook_secret
                          }
                          lastEventAt={
                            selectedCheckoutIntegration.last_event_at
                          }
                        />
                      ) : (
                        <p className="mb-3 text-sm text-muted-foreground">
                          Este webhook já foi persistido e pode ser configurado no
                          provedor.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {selectedCheckoutIntegration?.provider !== "hotmart"
                        || selectedCheckoutIntegration.has_webhook_secret ? (
                          <Button
                            variant="outline"
                            className="min-h-11 gap-2"
                            onClick={() => {
                              if (!gatewayWebhookUrl) return;
                              void navigator.clipboard.writeText(gatewayWebhookUrl);
                              toast.success("Webhook copiado");
                            }}
                          >
                            <Copy className="h-4 w-4" />
                            Copiar webhook
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            className="min-h-11 gap-2"
                            onClick={() => navigate(integrationsPath)}
                          >
                            <Settings2 className="h-4 w-4" />
                            Configurar Hottok
                          </Button>
                        )}
                        {project
                        && selectedCheckoutIntegration?.provider === "hotmart" ? (
                          <>
                            <HotmartImportDialog
                              projectId={project.id}
                              onImported={() => load(false)}
                            />
                            <HotmartBackfillDialog
                              workspaceId={project.workspace_id}
                              projectId={project.id}
                              integrationId={selectedCheckoutIntegration.id}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : checkoutEnabled && checkoutIntegrationId ? (
                    <p className="text-sm text-muted-foreground">
                      Salve as fontes para persistir o vínculo e liberar a URL do
                      webhook.
                    </p>
                  ) : null}
                </>
              )}

              {isWorkspaceAdmin
              && (!selectedCheckoutIntegration
                || selectedCheckoutIntegration.provider === "hubla")
              && project ? (
                <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-medium">Histórico de vendas da Hubla</p>
                    <p className="mt-1 text-xs leading-4 text-muted-foreground">
                      Valide e importe CSV/XLSX retroativo sem alterar a configuração do webhook.
                    </p>
                  </div>
                  <HublaImportDialog
                    projectId={project.id}
                    onImported={() => load(false)}
                  />
                </div>
              ) : null}
            </div>
          </SourceSection>

          {isWorkspaceAdmin && (
            <div className="sticky bottom-4 z-20 flex justify-end rounded-xl border border-border/70 bg-background/95 p-3 shadow-lg backdrop-blur">
              <Button onClick={saveSources} disabled={saving || !isDirty} className="min-h-11 gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {isDirty ? "Salvar fontes do funil" : "Fontes salvas"}
              </Button>
            </div>
          )}
        </div>
      ) : !isWorkspaceAdmin ? (
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <h2 className="font-semibold">Acesso restrito</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Somente owners e admins do cliente podem gerenciar links públicos.
          </p>
        </div>
      ) : (
        <SharingList
          links={publicLinks}
          canManage={isWorkspaceAdmin}
          onToggle={updatePublicLink}
          onRevoke={revokePublicLink}
        />
      )}
    </main>
  );
}

function SourceSection({
  icon,
  title,
  description,
  connected,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  connected: boolean;
  children: ReactNode;
}) {
  return (
    <section className="section-card p-4 md:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              connected ? "bg-green-500/10 text-green-700" : "bg-secondary text-muted-foreground",
            )}
          >
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-7">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            connected ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground",
          )}
        >
          {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {connected ? "Vinculada" : "Sem vínculo"}
        </span>
      </div>
      {children}
    </section>
  );
}

function HotmartWebhookGuide({
  hasHottok,
  lastEventAt,
}: {
  hasHottok: boolean;
  lastEventAt: string | null;
}) {
  if (!hasHottok) {
    return (
      <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Webhook ainda não pode receber eventos
        </p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Primeiro salve o Hottok nas Integrações do Cliente. Depois volte,
          copie a URL deste funil e cadastre-a na Hotmart.
        </p>
      </div>
    );
  }

  const steps = [
    "Abra Ferramentas → Webhook na Hotmart.",
    "Crie uma configuração na versão 2.0.0.",
    "Selecione somente os produtos vinculados acima.",
    "Marque compra aprovada, completa, reembolso, chargeback, recusa, boleto e abandono.",
    "Cole a URL persistida abaixo.",
    "Envie um evento de teste e acompanhe a Saúde do funil.",
  ];
  return (
    <div className="mb-4">
      <p className="text-sm font-semibold">Ativar vendas novas da Hotmart</p>
      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-muted-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-foreground">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <div
        className={cn(
          "mt-4 flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm",
          lastEventAt
            ? "border-green-500/25 bg-green-500/5 text-green-700"
            : "border-blue-500/20 bg-blue-500/5 text-foreground",
        )}
        role="status"
      >
        {lastEventAt ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 motion-reduce:animate-none" />
        )}
        <span>
          {lastEventAt
            ? `A integração recebeu um evento em ${format(
                new Date(lastEventAt),
                "dd/MM/yyyy 'às' HH:mm",
                { locale: ptBR },
              )}`
            : "Aguardando o evento de teste da Hotmart"}
        </span>
      </div>
    </div>
  );
}

function HotmartDataFlow({ hasHottok }: { hasHottok: boolean }) {
  return (
    <div className="grid gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 md:grid-cols-2">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-blue-700">
          <Database className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">API conectada</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Carrega produtos, ofertas e o histórico de vendas.
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-blue-700">
          <Radio className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">
            Webhook {hasHottok ? "protegido" : "pendente"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Recebe vendas, reembolsos e chargebacks novos em tempo real.
          </p>
        </div>
      </div>
    </div>
  );
}

function ResourceCheckbox({
  checked,
  disabled,
  label,
  detail,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  detail: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 items-start gap-3 rounded-lg border p-3",
        checked ? "border-primary/40 bg-primary/5" : "border-border/60",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}

function MissingResource({ message, onAdd }: { message: string; onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onAdd && (
        <Button variant="outline" onClick={onAdd} className="min-h-11 shrink-0">
          Adicionar integração ao cliente
        </Button>
      )}
    </div>
  );
}

function SharingList({
  links,
  canManage,
  onToggle,
  onRevoke,
}: {
  links: PublicLinkRow[];
  canManage: boolean;
  onToggle: (link: PublicLinkRow, enabled: boolean) => Promise<void>;
  onRevoke: (link: PublicLinkRow) => Promise<void>;
}) {
  if (links.length === 0) {
    return (
      <section className="section-card p-8 text-center md:p-12">
        <LinkIcon className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Nenhum link público</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie um link para compartilhar o dashboard sem expor integrações ou configurações.
        </p>
      </section>
    );
  }

  return (
    <section className="section-card overflow-hidden">
      <div className="hidden grid-cols-[minmax(160px,1fr)_120px_150px_150px_auto] gap-4 border-b px-6 py-3 text-xs font-medium text-muted-foreground md:grid">
        <span>Nome</span>
        <span>Status</span>
        <span>Validade</span>
        <span>Último acesso</span>
        <span className="text-right">Ações</span>
      </div>
      <div className="divide-y">
        {links.map((link) => {
          const expired = Boolean(link.expires_at && new Date(link.expires_at).getTime() < Date.now());
          const status = expired ? "Expirado" : link.enabled ? "Ativo" : "Desativado";
          const shareUrl = `${publicConfig.appUrl}/share/${link.token}`;
          return (
            <div
              key={link.id}
              className="grid gap-3 p-4 md:grid-cols-[minmax(160px,1fr)_120px_150px_150px_auto] md:items-center md:px-6"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{link.label || "Acesso do cliente"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Criado em {format(new Date(link.created_at), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              </div>
              <span
                className={cn(
                  "w-fit rounded-full px-2.5 py-1 text-xs font-medium",
                  status === "Ativo"
                    ? "bg-green-500/10 text-green-700"
                    : status === "Expirado"
                      ? "bg-red-500/10 text-red-700"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {status === "Ativo" ? (
                  <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                ) : (
                  <Circle className="mr-1 inline h-3.5 w-3.5" />
                )}
                {status}
              </span>
              <p className="text-sm text-muted-foreground">
                {link.expires_at
                  ? format(new Date(link.expires_at), "dd/MM/yyyy", { locale: ptBR })
                  : "Sem expiração"}
              </p>
              <p className="text-sm text-muted-foreground">
                {link.last_accessed_at
                  ? format(new Date(link.last_accessed_at), "dd/MM HH:mm", { locale: ptBR })
                  : "Nunca acessado"}
              </p>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                <Button
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11"
                  onClick={() => {
                    void navigator.clipboard.writeText(shareUrl);
                    toast.success("Link copiado");
                  }}
                >
                  <Copy className="h-4 w-4" />
                  <span className="sr-only">Copiar link</span>
                </Button>
                {canManage && !expired && (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void onToggle(link, !link.enabled)}
                  >
                    {link.enabled ? "Desativar" : "Reativar"}
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 text-destructive hover:text-destructive"
                    onClick={() => void onRevoke(link)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Revogar link</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InlineError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-destructive/30 bg-destructive/5 p-4", className)} role="alert">
      <p className="text-sm font-medium text-destructive">Algo deu errado</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-4 min-h-11">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

function checkoutProductFingerprint(value: CheckoutProductBinding[]) {
  return [...value]
    .sort((left, right) => left.product_id.localeCompare(right.product_id))
    .map(
      (item) =>
        `${item.product_id}:${item.offer_id ?? "*"}:${item.role}`,
    )
    .join("|");
}

function providerName(provider: WorkspaceCheckoutIntegrationSafeRow["provider"]) {
  if (provider === "hotmart") return "Hotmart";
  if (provider === "hubla") return "Hubla";
  return "Kiwify";
}

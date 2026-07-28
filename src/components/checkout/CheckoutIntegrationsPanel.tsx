import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";
import {
  type CheckoutProvider,
  type WorkspaceCheckoutIntegrationSafeRow,
  listWorkspaceCheckoutIntegrationsSafe,
} from "@/lib/operationalReadApi";
import { isHotmartCheckoutEnabled } from "@/lib/publicConfig";

type EditorState = {
  integration: WorkspaceCheckoutIntegrationSafeRow | null;
  provider: CheckoutProvider | "";
  label: string;
  webhookSecret: string;
  hotmartClientId: string;
  hotmartClientSecret: string;
  hotmartBasicToken: string;
  editHotmartHottok: boolean;
};

const EMPTY_EDITOR: EditorState = {
  integration: null,
  provider: "",
  label: "",
  webhookSecret: "",
  hotmartClientId: "",
  hotmartClientSecret: "",
  hotmartBasicToken: "",
  editHotmartHottok: false,
};

export function CheckoutIntegrationsPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const hotmartEnabled = isHotmartCheckoutEnabled(workspaceId);
  const [integrations, setIntegrations] = useState<
    WorkspaceCheckoutIntegrationSafeRow[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setIntegrations(await listWorkspaceCheckoutIntegrationsSafe(workspaceId));
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Falha ao carregar os checkouts.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveIntegration() {
    if (!editor?.provider) return;
    const savesHotmartCredential =
      editor.provider === "hotmart" && !editor.editHotmartHottok;
    if (
      savesHotmartCredential
      && (
        !editor.hotmartClientId.trim()
        || !editor.hotmartClientSecret.trim()
        || !editor.hotmartBasicToken.trim()
      )
    ) {
      toast.error("Informe Client ID, Client Secret e token Basic.");
      return;
    }
    if (
      editor.provider === "hotmart"
      && editor.editHotmartHottok
      && !editor.webhookSecret.trim()
    ) {
      toast.error("Informe o Hottok.");
      return;
    }
    if (
      editor.provider !== "hotmart"
      && !editor.integration
      && !editor.webhookSecret.trim()
    ) {
      toast.error("Informe o secret do webhook.");
      return;
    }

    setSaving(true);
    try {
      if (savesHotmartCredential) {
        const { data, error } = await supabase.functions.invoke(
          "hotmart-auth",
          {
            body: {
              action: "connect",
              workspace_id: workspaceId,
              integration_id: editor.integration?.id,
              label: editor.label.trim() || "Hotmart",
              client_id: editor.hotmartClientId.trim(),
              client_secret: editor.hotmartClientSecret.trim(),
              basic_token: editor.hotmartBasicToken.trim(),
            },
          },
        );
        if (error) {
          throw new Error(
            await edgeFunctionErrorMessage(
              error,
              "A Hotmart não aceitou essas credenciais.",
            ),
          );
        }
        if (data?.ok === false) throw new Error(data.error);
        const integrationId = String(data?.integration_id ?? "");
        if (!integrationId) throw new Error("Integração Hotmart não criada.");
        setEditor(null);
        await load();
        try {
          await syncHotmartCatalog(workspaceId, integrationId);
          await load();
          toast.success("Hotmart conectada e produtos carregados.");
        } catch (catalogError) {
          toast.warning(
            catalogError instanceof Error
              ? `Hotmart conectada. ${catalogError.message}`
              : "Hotmart conectada; atualize o catálogo novamente.",
          );
        }
        return;
      }

      const { data, error } = await supabase.functions.invoke(
        "workspace-credentials",
        {
          body: {
            action: "upsert_checkout_integration",
            workspace_id: workspaceId,
            integration_id: editor.integration?.id,
            provider: editor.provider,
            label:
              editor.label.trim()
              || editor.integration?.label
              || providerLabel(editor.provider),
            webhook_secret: editor.webhookSecret.trim() || undefined,
          },
        },
      );
      if (error) {
        throw new Error(
          await edgeFunctionErrorMessage(
            error,
            "Não foi possível salvar o checkout.",
          ),
        );
      }
      if (data?.ok === false) throw new Error(data.error);
      setEditor(null);
      await load();
      toast.success(
        editor.provider === "hotmart"
          ? "Hottok salvo"
          : `${providerLabel(editor.provider)} conectada`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao salvar checkout.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function refreshCatalog(integrationId: string) {
    setWorkingId(integrationId);
    try {
      await syncHotmartCatalog(workspaceId, integrationId);
      toast.success("Catálogo Hotmart atualizado.");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao atualizar catálogo.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  async function removeIntegration(
    integration: WorkspaceCheckoutIntegrationSafeRow,
  ) {
    if (integration.bound_project_count > 0) {
      toast.error("Desvincule este checkout dos funis antes de removê-lo.");
      return;
    }
    if (!window.confirm(`Remover a integração ${integration.label}?`)) return;
    setWorkingId(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke(
        "workspace-credentials",
        {
          body: {
            action: "delete_checkout_integration",
            workspace_id: workspaceId,
            integration_id: integration.id,
          },
        },
      );
      if (error) {
        throw new Error(
          await edgeFunctionErrorMessage(
            error,
            "Não foi possível remover o checkout.",
          ),
        );
      }
      if (data?.ok === false) throw new Error(data.error);
      await load();
      toast.success("Checkout removido");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao remover checkout.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg leading-7">
                    Checkouts
                  </CardTitle>
                  <StatusPill
                    label={
                      integrations.length > 0
                        ? `${integrations.length} configurado${integrations.length === 1 ? "" : "s"}`
                        : "Não configurado"
                    }
                    tone={integrations.length > 0 ? "success" : "neutral"}
                  />
                </div>
                <CardDescription>
                  Hubla e Hotmart podem coexistir; cada funil escolhe sua fonte.
                </CardDescription>
              </div>
            </div>
            {canManage ? (
              <Button
                className="min-h-11 gap-2"
                onClick={() => setEditor(EMPTY_EDITOR)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Adicionar checkout
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-5 md:p-6">
          {loading ? (
            <div className="flex min-h-28 items-center justify-center" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="sr-only">Carregando checkouts</span>
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button
                variant="outline"
                className="mt-3 min-h-11"
                onClick={() => void load()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : integrations.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">Nenhum checkout conectado</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Conecte Hubla ou Hotmart e depois vincule os produtos aos funis.
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {integrations.map((integration) => (
                <div
                  key={integration.id}
                  className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {integration.label}
                      </p>
                      <StatusPill
                        label={integrationStatusLabel(integration)}
                        tone={integrationStatusTone(integration)}
                      />
                    </div>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      {integration.provider} · {integration.product_count} produto(s) ·{" "}
                      {integration.bound_project_count} funil(is)
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {lastActivityLabel(integration)}
                    </p>
                    {integration.last_error_message ? (
                      <p className="mt-2 text-xs text-destructive">
                        {integration.last_error_message}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {integration.provider === "hotmart" ? (
                        <>
                          <Button
                            variant="outline"
                            className="min-h-11 gap-2"
                            disabled={workingId === integration.id}
                            onClick={() => void refreshCatalog(integration.id)}
                          >
                            <RefreshCw
                              className={`h-4 w-4 ${
                                workingId === integration.id ? "animate-spin" : ""
                              }`}
                              aria-hidden="true"
                            />
                            Catálogo
                          </Button>
                          <Button
                            variant="outline"
                            className="min-h-11 gap-2"
                            onClick={() =>
                              setEditor({
                                integration,
                                provider: integration.provider,
                                label: integration.label,
                                webhookSecret: "",
                                hotmartClientId: "",
                                hotmartClientSecret: "",
                                hotmartBasicToken: "",
                                editHotmartHottok: true,
                              })
                            }
                          >
                            <KeyRound className="h-4 w-4" aria-hidden="true" />
                            Hottok
                          </Button>
                          <Button
                            variant="outline"
                            className="min-h-11"
                            disabled={workingId === integration.id}
                            onClick={() =>
                              setEditor({
                                integration,
                                provider: "hotmart",
                                label: integration.label,
                                webhookSecret: "",
                                hotmartClientId: "",
                                hotmartClientSecret: "",
                                hotmartBasicToken: "",
                                editHotmartHottok: false,
                              })
                            }
                          >
                            Reconectar
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          className="min-h-11"
                          onClick={() =>
                            setEditor({
                              integration,
                                provider: integration.provider,
                                label: integration.label,
                                webhookSecret: "",
                                hotmartClientId: "",
                                hotmartClientSecret: "",
                                hotmartBasicToken: "",
                                editHotmartHottok: false,
                              })
                          }
                        >
                          Configurar
                        </Button>
                      )}
                      {integration.bound_project_count === 0 ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-destructive hover:text-destructive"
                          aria-label={`Remover ${integration.label}`}
                          disabled={workingId === integration.id}
                          onClick={() => void removeIntegration(integration)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={editor != null} onOpenChange={(open) => !open && setEditor(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {editor?.integration ? "Configurar checkout" : "Adicionar checkout"}
            </SheetTitle>
            <SheetDescription>
              Secrets são enviados diretamente ao backend e nunca voltam para esta tela.
            </SheetDescription>
          </SheetHeader>
          {editor ? (
            <div className="space-y-5 py-6">
              <div className="space-y-2">
                <Label htmlFor="checkout-provider">Provedor</Label>
                <Select
                  value={editor.provider}
                  disabled={Boolean(editor.integration)}
                  onValueChange={(provider) =>
                    setEditor((current) =>
                      current
                        ? {
                          ...current,
                          provider: provider as CheckoutProvider,
                          label: providerLabel(provider as CheckoutProvider),
                        }
                        : current,
                    )
                  }
                >
                  <SelectTrigger id="checkout-provider" className="min-h-11">
                    <SelectValue placeholder="Selecione o provedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hubla">Hubla</SelectItem>
                    {hotmartEnabled ? (
                      <SelectItem value="hotmart">Hotmart</SelectItem>
                    ) : null}
                    <SelectItem value="kiwify">Kiwify</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-label">Nome da conexão</Label>
                <Input
                  id="checkout-label"
                  value={editor.label}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, label: event.target.value } : current,
                    )
                  }
                  placeholder="Ex.: Hotmart principal"
                />
              </div>
              {editor.provider === "hotmart"
              && !editor.editHotmartHottok ? (
                <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                  <div>
                    <p className="text-sm font-medium">
                      Credenciais Developers da Hotmart
                    </p>
                    <p className="mt-1 text-xs leading-4 text-muted-foreground">
                      Em Ferramentas → Credenciais, crie uma credencial e copie
                      os três valores. Eles serão validados e guardados no Vault.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hotmart-client-id">Client ID</Label>
                    <Input
                      id="hotmart-client-id"
                      type="password"
                      autoComplete="off"
                      value={editor.hotmartClientId}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? {
                                ...current,
                                hotmartClientId: event.target.value,
                              }
                            : current,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hotmart-client-secret">
                      Client Secret
                    </Label>
                    <Input
                      id="hotmart-client-secret"
                      type="password"
                      autoComplete="off"
                      value={editor.hotmartClientSecret}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? {
                                ...current,
                                hotmartClientSecret: event.target.value,
                              }
                            : current,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hotmart-basic-token">Token Basic</Label>
                    <Input
                      id="hotmart-basic-token"
                      type="password"
                      autoComplete="off"
                      value={editor.hotmartBasicToken}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? {
                                ...current,
                                hotmartBasicToken: event.target.value,
                              }
                            : current,
                        )
                      }
                      placeholder="Basic ..."
                    />
                  </div>
                </div>
              ) : editor.provider ? (
                <div className="space-y-2">
                  <Label htmlFor="checkout-secret">
                    {editor.provider === "hotmart" ? "Hottok" : "Secret do webhook"}
                  </Label>
                  <Input
                    id="checkout-secret"
                    type="password"
                    autoComplete="off"
                    value={editor.webhookSecret}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? { ...current, webhookSecret: event.target.value }
                          : current,
                      )
                    }
                    placeholder={
                      editor.integration
                        ? "Deixe vazio para manter o secret atual"
                        : "Cole o secret do provedor"
                    }
                  />
                  {editor.provider === "hotmart" ? (
                    <p className="text-xs leading-4 text-muted-foreground">
                      O Hottok valida somente os eventos enviados pelo webhook.
                      Ele é diferente das credenciais usadas para carregar o
                      histórico.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <SheetFooter>
            <Button
              className="min-h-11 gap-2"
              disabled={saving || !editor?.provider}
              onClick={() => void saveIntegration()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              {editor?.provider === "hotmart"
              && !editor.editHotmartHottok
                ? "Validar e conectar"
                : editor?.editHotmartHottok
                  ? "Salvar Hottok"
                  : "Salvar checkout"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function providerLabel(provider: CheckoutProvider) {
  if (provider === "hotmart") return "Hotmart";
  if (provider === "hubla") return "Hubla";
  return "Kiwify";
}

async function syncHotmartCatalog(
  workspaceId: string,
  integrationId: string,
) {
  const { data, error } = await supabase.functions.invoke("hotmart-sync", {
    body: {
      action: "sync_catalog",
      workspace_id: workspaceId,
      integration_id: integrationId,
    },
  });
  if (error) {
    throw new Error(
      await edgeFunctionErrorMessage(
        error,
        "Não foi possível carregar o catálogo Hotmart.",
      ),
    );
  }
  if (data?.ok === false) throw new Error(data.error);
}

function integrationStatusLabel(
  integration: WorkspaceCheckoutIntegrationSafeRow,
) {
  if (integration.status === "disconnected") return "Desconectada";
  if (integration.status === "requires_action") return "Requer ação";
  if (!integration.has_webhook_secret) {
    return integration.provider === "hotmart" ? "Falta Hottok" : "Falta secret";
  }
  if (integration.status === "pending") return "Configuração pendente";
  return "Conectada";
}

function integrationStatusTone(
  integration: WorkspaceCheckoutIntegrationSafeRow,
): "success" | "warning" | "danger" | "neutral" {
  if (integration.status === "requires_action") return "danger";
  if (
    integration.status === "pending"
    || !integration.has_webhook_secret
  ) return "warning";
  if (integration.status === "connected") return "success";
  return "neutral";
}

function lastActivityLabel(
  integration: WorkspaceCheckoutIntegrationSafeRow,
) {
  const value =
    integration.last_event_at
    ?? integration.last_backfill_at
    ?? integration.catalog_synced_at;
  if (!value) return "Nenhuma atividade registrada";
  return `Última atividade em ${new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

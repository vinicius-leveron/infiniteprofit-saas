import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Save } from "lucide-react";
import { AdminPage } from "@/components/admin/AdminPage";
import { AsyncState } from "@/components/admin/AsyncState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAdminClient } from "@/components/admin/useAdminClient";
import { toast } from "sonner";

export default function ClientSettings() {
  const { client, clientId, organization, canManage } = useAdminClient();
  const { refreshAccess } = useWorkspace();
  const [name, setName] = useState(client?.name ?? "");
  const [loading, setLoading] = useState(Boolean(clientId));
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadClient = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from("workspaces")
        .select("name")
        .eq("id", clientId)
        .single();
      if (error) throw error;
      setName(data.name);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao carregar o cliente.",
      );
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    void loadClient();
  }, [clientId, loadClient]);

  async function saveClient() {
    if (!clientId || !name.trim() || !canManage) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("workspaces")
        .update({ name: name.trim() })
        .eq("id", clientId);
      if (error) throw error;
      await refreshAccess();
      toast.success("Configurações do cliente atualizadas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  const status = loading
    ? "loading"
    : errorMessage || !clientId
      ? "error"
      : "ready";

  return (
    <AdminPage
      context={client?.name ?? "Cliente"}
      title="Configurações"
      description="Dados gerais do cliente. Integrações e pessoas são administradas em áreas próprias."
    >
      <AsyncState
        status={status}
        errorMessage={errorMessage ?? "Cliente não encontrado ou sem acesso."}
        onRetry={() => void loadClient()}
      >
        <div className="grid gap-6 lg:grid-cols-[220px,minmax(0,800px)]">
          <nav aria-label="Seções das configurações" className="hidden lg:block">
            <div className="rounded-lg border bg-card p-2">
              <div className="flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium">
                <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
                Dados gerais
              </div>
            </div>
          </nav>

          <Card>
            <CardHeader className="p-5 md:p-6">
              <CardTitle className="text-lg leading-7">Dados gerais</CardTitle>
              <CardDescription>
                Este nome identifica o cliente no seletor global e nas páginas administrativas.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6 p-5 md:p-6">
              <div className="space-y-2">
                <Label htmlFor="client-settings-name">Nome do cliente</Label>
                <Input
                  id="client-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!canManage}
                  className="max-w-xl"
                />
                <p className="text-xs leading-4 text-muted-foreground">
                  Organização: {organization?.name ?? "não identificada"}
                </p>
              </div>
              {canManage && (
                <Button
                  className="min-h-11 gap-2"
                  disabled={saving || !name.trim()}
                  onClick={() => void saveClient()}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  Salvar alterações
                </Button>
              )}
              {!canManage && (
                <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Você pode consultar estas informações, mas somente administradores podem
                  alterá-las.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </AsyncState>
    </AdminPage>
  );
}

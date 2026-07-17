import { useCallback, useEffect, useState } from "react";
import { Building, Loader2, Save } from "lucide-react";
import { AdminPage } from "@/components/admin/AdminPage";
import { AsyncState } from "@/components/admin/AsyncState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";

export default function OrganizationGeneral() {
  const {
    currentOrganization,
    currentWorkspace,
    organizations,
    currentOrganizationRole,
    refreshAccess,
  } = useWorkspace();
  const organization =
    currentOrganization ??
    organizations.find((entry) => entry.id === currentWorkspace?.organization_id) ??
    organizations[0] ??
    null;
  const canManage =
    currentOrganizationRole === "owner" ||
    currentOrganizationRole === "admin" ||
    organization?.role === "owner" ||
    organization?.role === "admin";

  const [name, setName] = useState(organization?.name ?? "");
  const [loading, setLoading] = useState(Boolean(organization?.id));
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadOrganization = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organization.id)
        .single();
      if (error) throw error;
      setName(data.name);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao carregar a organização.",
      );
    } finally {
      setLoading(false);
    }
  }, [organization?.id]);

  useEffect(() => {
    if (!organization?.id) {
      setLoading(false);
      return;
    }
    void loadOrganization();
  }, [loadOrganization, organization?.id]);

  async function saveOrganization() {
    if (!organization?.id || !canManage || !name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ name: name.trim() })
        .eq("id", organization.id);
      if (error) throw error;
      await refreshAccess();
      toast.success("Organização atualizada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao salvar a organização.",
      );
    } finally {
      setSaving(false);
    }
  }

  const status = loading
    ? "loading"
    : errorMessage || !organization
      ? "error"
      : "ready";

  return (
    <AdminPage
      context="Organização"
      title="Configurações gerais"
      description="Defina os dados que identificam sua agência ou empresa. Clientes, equipe e integrações ficam em suas áreas específicas."
    >
      <AsyncState
        status={status}
        errorMessage={errorMessage ?? "Organização não encontrada ou sem acesso."}
        onRetry={() => void loadOrganization()}
      >
        <div className="grid gap-6 lg:grid-cols-[220px,minmax(0,800px)]">
          <nav aria-label="Seções das configurações" className="hidden lg:block">
            <div className="rounded-lg border bg-card p-2">
              <div className="flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium">
                <Building className="h-4 w-4 text-primary" aria-hidden="true" />
                Dados gerais
              </div>
            </div>
          </nav>

          <Card>
            <CardHeader className="p-5 md:p-6">
              <CardTitle className="text-lg leading-7">Identificação</CardTitle>
              <CardDescription>
                Este nome aparece no seletor global e na administração dos clientes.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6 p-5 md:p-6">
              <div className="space-y-2">
                <Label htmlFor="organization-name">Nome da organização</Label>
                <Input
                  id="organization-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!canManage}
                  className="max-w-xl"
                />
              </div>
              {canManage && (
                <Button
                  className="min-h-11 gap-2"
                  disabled={saving || !name.trim()}
                  onClick={() => void saveOrganization()}
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
                  Você pode consultar estas informações, mas não possui permissão para
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

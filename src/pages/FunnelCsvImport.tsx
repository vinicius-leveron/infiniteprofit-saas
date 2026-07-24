import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CsvUpload } from "@/components/CsvUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { supabase } from "@/integrations/supabase/client";
import { parseCsv } from "@/lib/csv";

interface PreparedCsv {
  text: string;
  fileName: string;
  rowCount: number;
}

export default function FunnelCsvImport() {
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const { workspaces, isWorkspaceAdmin, setCurrentWorkspaceId } = useWorkspace();
  const client = workspaces.find((workspace) => workspace.id === clientId) ?? null;
  const [prepared, setPrepared] = useState<PreparedCsv | null>(null);
  const [name, setName] = useState("");
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (clientId && client) setCurrentWorkspaceId(clientId);
  }, [client, clientId, setCurrentWorkspaceId]);

  const prepareFile = (text: string, fileName: string) => {
    try {
      const parsed = parseCsv(text);
      if (parsed.rows.length === 0) {
        throw new Error("A planilha não contém dias válidos para o dashboard.");
      }
      setPrepared({ text, fileName, rowCount: parsed.rows.length });
      setName(fileName.replace(/\.[^.]+$/, ""));
      setValidationError("");
    } catch (error) {
      setPrepared(null);
      setValidationError(
        error instanceof Error
          ? error.message
          : "Não foi possível interpretar esta planilha.",
      );
    }
  };

  const save = async () => {
    if (!prepared || !user || !client || !isWorkspaceAdmin || name.trim().length < 2) {
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        workspace_id: client.id,
        name: name.trim(),
        source: "csv",
        file_name: prepared.fileName,
        csv_content: prepared.text,
      })
      .select("id")
      .single();
    setSaving(false);

    if (error || !data) {
      toast.error("Não foi possível criar o funil com esta planilha.");
      return;
    }

    toast.success("Planilha importada e funil criado.");
    navigate(`/dashboard?project=${data.id}&tab=geral`, { replace: true });
  };

  if (!client || !isWorkspaceAdmin) {
    return (
      <main className="page-shell">
        <section className="section-card py-12 text-center" role="alert">
          <h1 className="text-xl font-semibold">Importação indisponível</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Selecione um cliente em que você seja owner ou admin.
          </p>
          <Button className="mt-5" onClick={() => navigate("/clients")}>
            Ver clientes
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell pb-12">
      <header className="mb-8 flex items-start gap-3">
        <Button
          variant="ghost"
          className="min-h-11 shrink-0 gap-2"
          onClick={() => navigate(`/clients/${client.id}/funnels`)}
        >
          <ArrowLeft className="h-4 w-4" />
          Funis
        </Button>
        <div>
          <p className="text-sm font-medium text-primary">{client.name}</p>
          <h1 className="mt-1 text-2xl font-bold leading-8">Importar planilha</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            Crie um funil manual a partir de uma planilha de KPIs. Para histórico de
            vendas da Hubla, use a opção recomendada na criação do funil conectado.
          </p>
        </div>
      </header>

      <section className="section-card">
        {!prepared ? (
          <>
            <CsvUpload
              onFile={prepareFile}
              title="Selecione a planilha de KPIs"
              description="Você pode juntar vários CSVs com o mesmo cabeçalho e período contínuo."
            />
            {validationError && (
              <p className="mx-auto mt-4 max-w-xl text-center text-sm text-destructive" role="alert">
                {validationError}
              </p>
            )}
          </>
        ) : (
          <div className="mx-auto max-w-xl">
            <div className="flex items-start gap-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold">Planilha validada</h2>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {prepared.fileName} · {prepared.rowCount} dias encontrados
                </p>
              </div>
            </div>

            <div className="mt-6">
              <Label htmlFor="csv-funnel-name">Nome do funil</Label>
              <Input
                id="csv-funnel-name"
                className="mt-2 min-h-11"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border/60 pt-5 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={saving}
                onClick={() => setPrepared(null)}
              >
                Escolher outro arquivo
              </Button>
              <Button
                className="min-h-11 gap-2"
                disabled={saving || name.trim().length < 2}
                onClick={() => void save()}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                {saving ? "Criando funil" : "Criar e abrir dashboard"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

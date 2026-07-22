import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { HublaImportPicker } from "@/components/hubla/HublaImportPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  runHublaImport,
  type HublaImportResult,
  type PreparedHublaImport,
} from "@/lib/hublaImport";
import { cn } from "@/lib/utils";

type HublaImportDialogProps = {
  projectId: string;
  onImported?: (result: HublaImportResult) => void | Promise<void>;
};

export function HublaImportDialog({ projectId, onImported }: HublaImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedHublaImport | null>(null);
  const [csv, setCsv] = useState("");
  const [validatedCsv, setValidatedCsv] = useState("");
  const [result, setResult] = useState<HublaImportResult | null>(null);
  const [state, setState] = useState<"idle" | "validating" | "ready" | "importing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prepared) return;
    setCsv(prepared.csv);
    setValidatedCsv("");
    setResult(null);
    setError(null);
    setState("idle");
  }, [prepared]);

  function resetValidation(nextCsv = csv) {
    setCsv(nextCsv);
    setValidatedCsv("");
    setResult(null);
    setError(null);
    setState("idle");
  }

  async function validate() {
    if (!csv.trim()) return;
    setState("validating");
    setError(null);
    try {
      const preview = await runHublaImport(projectId, csv, true);
      setResult(preview);
      if (preview.imported === 0) {
        throw new Error("Nenhuma venda ou evento reconhecível foi encontrado neste arquivo.");
      }
      setValidatedCsv(csv);
      setState("ready");
    } catch (caught) {
      setValidatedCsv("");
      setError(caught instanceof Error ? caught.message : "Não foi possível validar o arquivo.");
      setState("error");
    }
  }

  async function importHistory() {
    if (!csv.trim() || csv !== validatedCsv) return;
    setState("importing");
    setError(null);
    try {
      const imported = await runHublaImport(projectId, csv, false);
      if (imported.imported === 0) {
        throw new Error("A importação terminou sem eventos reconhecidos.");
      }
      toast.success(`${imported.imported} evento(s) da Hubla importado(s)`);
      await onImported?.(imported);
      setOpen(false);
      setPrepared(null);
      setCsv("");
      setValidatedCsv("");
      setResult(null);
      setState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível importar o histórico.");
      setState("error");
    }
  }

  const busy = state === "validating" || state === "importing";
  const isValidated = Boolean(csv.trim()) && csv === validatedCsv && result?.imported;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 gap-2">
          <FileUp className="h-4 w-4" />
          Importar histórico Hubla
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar histórico da Hubla</DialogTitle>
          <DialogDescription>
            Valide um export de faturas/vendas ou uma planilha diária antes de adicionar os dados a este funil.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <HublaImportPicker
            value={prepared}
            onChange={(next) => {
              setPrepared(next);
              if (!next) resetValidation("");
            }}
            disabled={busy}
            compact
          />

          <div className="space-y-1.5">
            <Label htmlFor="hubla-csv-content">Conteúdo CSV</Label>
            <Textarea
              id="hubla-csv-content"
              value={csv}
              onChange={(event) => {
                setPrepared(null);
                resetValidation(event.target.value);
              }}
              rows={8}
              disabled={busy}
              placeholder="Ou cole aqui o conteúdo exportado da Hubla."
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              A validação é somente uma prévia. Nenhum dado é salvo até você confirmar a importação.
            </p>
          </div>

          {result && (
            <ImportPreview result={result} valid={result.imported > 0} />
          )}

          {error && (
            <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Arquivo não validado</p>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => void validate()}
            disabled={busy || !csv.trim()}
            className="min-h-11 gap-2"
          >
            {state === "validating" && <Loader2 className="h-4 w-4 animate-spin" />}
            {isValidated ? "Validar novamente" : "Validar arquivo"}
          </Button>
          <Button
            type="button"
            onClick={() => void importHistory()}
            disabled={busy || !isValidated}
            className="min-h-11 gap-2"
          >
            {state === "importing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Importar histórico
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportPreview({ result, valid }: { result: HublaImportResult; valid: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        valid ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5",
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {valid ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {result.imported} evento(s) reconhecido(s) · {result.skipped} linha(s) ignorada(s)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.dates.length > 0
              ? `${result.dates.length} data(s) serão atualizadas.`
              : "Nenhuma data reconhecida."}
          </p>
          {result.warnings.length > 0 && (
            <div className="mt-3 rounded-md border border-border/50 bg-background/60 p-3">
              <p className="text-xs font-medium">Avisos da validação</p>
              <ul className="mt-1 space-y-1 text-xs leading-4 text-muted-foreground">
                {result.warnings.slice(0, 5).map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
              {result.warnings.length > 5 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Mais {result.warnings.length - 5} aviso(s).
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

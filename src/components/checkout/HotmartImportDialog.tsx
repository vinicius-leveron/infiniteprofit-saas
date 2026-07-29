import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { HotmartImportPicker } from "@/components/checkout/HotmartImportPicker";
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
import {
  runHotmartImport,
  type HotmartImportResult,
  type PreparedHotmartImport,
} from "@/lib/hotmartImport";
import { cn } from "@/lib/utils";

type HotmartImportDialogProps = {
  projectId: string;
  onImported?: (result: HotmartImportResult) => void | Promise<void>;
};

export function HotmartImportDialog({
  projectId,
  onImported,
}: HotmartImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedHotmartImport | null>(null);
  const [validatedCsv, setValidatedCsv] = useState("");
  const [result, setResult] = useState<HotmartImportResult | null>(null);
  const [state, setState] = useState<
    "idle" | "validating" | "ready" | "importing" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValidatedCsv("");
    setResult(null);
    setError(null);
    setState("idle");
  }, [prepared]);

  async function validate() {
    if (!prepared?.csv.trim()) return;
    setState("validating");
    setError(null);
    try {
      const preview = await runHotmartImport(
        projectId,
        prepared.csv,
        true,
      );
      setResult(preview);
      if (preview.imported === 0) {
        throw new Error(
          preview.excluded > 0
            ? "As vendas foram reconhecidas, mas nenhuma pode entrar nas métricas. Revise os produtos vinculados e as moedas."
            : "Nenhuma venda reconhecível foi encontrada neste arquivo.",
        );
      }
      setValidatedCsv(prepared.csv);
      setState("ready");
    } catch (caught) {
      setValidatedCsv("");
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível validar a planilha.",
      );
      setState("error");
    }
  }

  async function importHistory() {
    if (!prepared?.csv.trim() || prepared.csv !== validatedCsv) return;
    setState("importing");
    setError(null);
    try {
      const imported = await runHotmartImport(
        projectId,
        prepared.csv,
        false,
      );
      if (imported.imported === 0) {
        throw new Error("A importação terminou sem vendas elegíveis.");
      }
      toast.success(
        `${imported.imported} venda(s) da Hotmart importada(s)`,
      );
      await onImported?.(imported);
      setOpen(false);
      setPrepared(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível importar o histórico.",
      );
      setState("error");
    }
  }

  const busy = state === "validating" || state === "importing";
  const isValidated = Boolean(
    prepared?.csv.trim()
    && prepared.csv === validatedCsv
    && result?.imported,
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 gap-2">
          <FileUp className="h-4 w-4" />
          Importar planilha Hotmart
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar histórico da Hotmart</DialogTitle>
          <DialogDescription>
            Use o relatório de vendas da Hotmart. Produtos e ofertas precisam
            estar vinculados a este funil antes da importação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <HotmartImportPicker
            value={prepared}
            onChange={setPrepared}
            disabled={busy}
            compact
          />

          <p className="text-xs leading-4 text-muted-foreground">
            A prévia não salva dados. Nome, email, telefone, documento e endereço
            são descartados no navegador e nunca entram no histórico do funil.
          </p>

          {result ? <ImportPreview result={result} /> : null}

          {error ? (
            <div
              className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Planilha não validada
                </p>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">
                  {error}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => void validate()}
            disabled={busy || !prepared?.csv.trim()}
            className="min-h-11 gap-2"
          >
            {state === "validating"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : null}
            {isValidated ? "Validar novamente" : "Validar planilha"}
          </Button>
          <Button
            type="button"
            onClick={() => void importHistory()}
            disabled={busy || !isValidated}
            className="min-h-11 gap-2"
          >
            {state === "importing"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileUp className="h-4 w-4" />}
            Importar histórico
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportPreview({ result }: { result: HotmartImportResult }) {
  const valid = result.imported > 0;
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        valid
          ? "border-green-500/30 bg-green-500/5"
          : "border-destructive/30 bg-destructive/5",
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {valid
          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
          : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {result.imported} venda(s) elegível(is)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.dates.length} data(s) serão atualizadas
            {result.excluded > 0
              ? ` · ${result.excluded} linha(s) preservada(s) sem afetar métricas`
              : ""}
            {result.skipped > 0
              ? ` · ${result.skipped} ignorada(s)`
              : ""}.
          </p>
          {result.warnings.length > 0 ? (
            <div className="mt-3 rounded-md border border-border/50 bg-background/60 p-3">
              <p className="text-xs font-medium">Avisos da validação</p>
              <ul className="mt-1 space-y-1 text-xs leading-4 text-muted-foreground">
                {result.warnings.slice(0, 5).map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
              {result.warnings.length > 5 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Mais {result.warnings.length - 5} aviso(s).
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

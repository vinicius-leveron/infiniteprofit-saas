import { useId, useState } from "react";
import { CheckCircle2, FileSpreadsheet, FileUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readHublaImportFile } from "@/lib/hublaImportFile";
import type { PreparedHublaImport } from "@/lib/hublaImport";
import { cn } from "@/lib/utils";

const ACCEPTED_HUBLA_FILES = ".csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

type HublaImportPickerProps = {
  value: PreparedHublaImport | null;
  onChange: (value: PreparedHublaImport | null) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function HublaImportPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: HublaImportPickerProps) {
  const inputId = useId();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const result = await readHublaImportFile(file);
      if (!result.csv.trim()) throw new Error("O arquivo está vazio.");
      onChange({
        csv: result.csv,
        fileName: file.name,
        kind: result.kind,
        sheetName: result.sheetName,
      });
    } catch (caught) {
      onChange(null);
      setError(caught instanceof Error ? caught.message : "Não foi possível ler o arquivo.");
    } finally {
      setReading(false);
    }
  }

  if (value) {
    return (
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10 text-green-700">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.fileName}</p>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
              {value.kind === "xlsx" && value.sheetName
                ? `Planilha pronta · aba “${value.sheetName}”`
                : "CSV pronto para validação"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 shrink-0"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Remover arquivo da Hubla</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 p-4 transition-colors hover:border-primary/50 hover:bg-primary/[0.03]",
          !compact && "sm:p-5",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {reading ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {reading ? "Lendo seu histórico…" : "Selecionar CSV ou XLSX da Hubla"}
          </span>
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            Export de faturas/vendas ou planilha diária de acompanhamento.
          </span>
        </span>
        <FileUp className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
      </label>
      <input
        id={inputId}
        className="sr-only"
        type="file"
        accept={ACCEPTED_HUBLA_FILES}
        disabled={disabled || reading}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {error && (
        <p className="mt-2 text-xs leading-4 text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

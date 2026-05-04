import { useCallback, useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  onFile: (text: string, name: string) => void;
}

/** Junta múltiplos CSVs preservando o header só do primeiro. */
function mergeCsvTexts(texts: string[]): string {
  const out: string[] = [];
  let header: string | null = null;
  for (const t of texts) {
    const lines = t.replace(/\r\n/g, "\n").split("\n");
    if (!lines.length) continue;
    // localiza primeira linha não vazia (header)
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) continue;
    const thisHeader = lines[i];
    if (!header) {
      header = thisHeader;
      out.push(header);
    }
    // adiciona resto (pulando header desta planilha)
    for (let j = i + 1; j < lines.length; j++) {
      out.push(lines[j]);
    }
  }
  return out.join("\n");
}

export const CsvUpload = ({ onFile }: Props) => {
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFiles = useCallback((fileList: File[]) => {
    setError(null);
    const files = fileList.filter((f) => /\.csv$/i.test(f.name));
    if (!files.length) {
      setError("Selecione um ou mais arquivos .csv");
      return;
    }
    files.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
    setSelected((prev) => {
      // dedup por nome+tamanho
      const key = (f: File) => `${f.name}__${f.size}`;
      const map = new Map(prev.map((f) => [key(f), f]));
      files.forEach((f) => map.set(key(f), f));
      const merged = Array.from(map.values());
      merged.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
      return merged;
    });
  }, []);

  const removeFile = useCallback((idx: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearAll = useCallback(() => {
    setSelected([]);
    setError(null);
  }, []);

  const processFiles = useCallback(() => {
    if (!selected.length) return;
    setProcessing(true);
    setError(null);
    Promise.all(
      selected.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error(`Falha ao ler ${file.name}`));
            reader.readAsText(file, "utf-8");
          }),
      ),
    )
      .then((texts) => {
        const merged = selected.length === 1 ? texts[0] : mergeCsvTexts(texts);
        const name =
          selected.length === 1
            ? selected[0].name
            : `${selected.length} arquivos (${selected[0].name} … ${selected[selected.length - 1].name})`;
        onFile(merged, name);
      })
      .catch((e: Error) => {
        setError(e.message);
        setProcessing(false);
      });
  }, [selected, onFile]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-brand mb-6 shadow-glow">
          <FileSpreadsheet className="w-7 h-7 text-primary-foreground" strokeWidth={2.2} />
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold gradient-text-brand mb-2">
          Infinite Profit
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Importe sua(s) planilha(s) CSV de KPIs para visualizar o dashboard completo
        </p>

        <div
          className={cn(
            "rounded-[var(--radius)] border-2 border-dashed bg-card/50 px-6 py-10 cursor-pointer transition-all",
            drag ? "border-primary bg-primary/5 shadow-glow" : "border-border hover:border-primary/60 hover:bg-card",
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length) pickFiles(files);
          }}
        >
          <Upload className="w-12 h-12 mx-auto mb-3 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm font-medium text-foreground/90">
            Arraste seu(s) CSV(s) aqui ou clique para selecionar
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">
            Selecione vários arquivos (um por mês) — serão unificados automaticamente
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) pickFiles(files);
            // reset para permitir reupload do mesmo conjunto
            e.target.value = "";
          }}
        />

        {selected.length > 0 && (
          <div className="mt-5 rounded-[var(--radius)] border border-border bg-card/40 p-3 text-left animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground/80">
                {selected.length} arquivo{selected.length === 1 ? "" : "s"} selecionado
                {selected.length === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                disabled={processing}
              >
                Limpar
              </button>
            </div>
            <ul className="max-h-40 overflow-y-auto space-y-1 mb-3">
              {selected.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 text-xs text-foreground/80 bg-background/40 rounded px-2 py-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {(f.size / 1024).toFixed(1)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    disabled={processing}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    aria-label={`Remover ${f.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              onClick={processFiles}
              disabled={processing}
              className="w-full gap-2"
              size="sm"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processando…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Importar {selected.length} arquivo{selected.length === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
};

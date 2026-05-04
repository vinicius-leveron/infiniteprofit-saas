import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SheetSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  initialUrl: string | null;
  initialToken: string | null;
  lastSyncedAt: string | null;
  onSaved: (data: { sheet_url: string; sync_token: string }) => void;
  onSynced: () => void;
}

type ValidationState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      message: string;
      preview?: { firstLines: string[]; lineCount: number; totalBytes: number };
    }
  | { kind: "error"; stage: string; message: string; hint?: string };

function genToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function SheetSyncDialog({
  open,
  onOpenChange,
  projectId,
  initialUrl,
  initialToken,
  lastSyncedAt,
  onSaved,
  onSynced,
}: SheetSyncDialogProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [token, setToken] = useState(initialToken ?? "");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({ kind: "idle" });

  const trimmedUrl = url.trim();
  const trimmedToken = token.trim();

  const isDirty = useMemo(() => {
    return (
      trimmedUrl !== (initialUrl ?? "").trim() ||
      trimmedToken !== (initialToken ?? "").trim()
    );
  }, [trimmedUrl, trimmedToken, initialUrl, initialToken]);

  const testUrl = useMemo(() => {
    if (!trimmedUrl) return "";
    try {
      const u = new URL(trimmedUrl);
      if (trimmedToken) u.searchParams.set("token", trimmedToken);
      return u.toString();
    } catch {
      return trimmedUrl;
    }
  }, [trimmedUrl, trimmedToken]);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? "");
      setToken(initialToken || genToken());
      setValidation({ kind: "idle" });
    }
  }, [open, initialUrl, initialToken]);

  // Reset validation quando o usuário muda algo
  useEffect(() => {
    if (validation.kind !== "idle") {
      setValidation({ kind: "idle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedUrl, trimmedToken]);

  const appsScriptCode = `// ⚠️ APAGUE TUDO do editor antes de colar este código.
// Não pode ter "function myFunction() { ... }" envolvendo nada.
// O doGet deve ficar no NÍVEL RAIZ do arquivo.
//
// Depois: Salvar (Ctrl+S) → Implantar → Gerenciar implantações
// → ✏️ Editar → Versão: NOVA VERSÃO → Tipo: App da Web
// → Executar como: Eu  ·  Quem tem acesso: Qualquer pessoa → Implantar.

const TOKEN = "${trimmedToken}";

function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) {
    return ContentService.createTextOutput("Forbidden")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  // Lê TODAS as abas (cada aba = um mês). Header é escrito uma vez só.
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  const allRows = [];
  let header = null;
  sheets.forEach(function (sheet) {
    const data = sheet.getDataRange().getValues();
    if (!data.length) return;
    if (!header) {
      header = data[0];
      allRows.push(header);
    }
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.every(function (c) { return c === "" || c == null; })) continue;
      allRows.push(row);
    }
  });
  const csv = allRows.map(function (row) {
    return row.map(function (cell) {
      const s = String(cell == null ? "" : cell);
      return /[",\\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }).join("\\n");
  return ContentService.createTextOutput(csv)
    .setMimeType(ContentService.MimeType.CSV);
}`;

  const handleSave = async (silent = false): Promise<boolean> => {
    if (!projectId) return false;
    if (!trimmedUrl.startsWith("https://script.google.com/")) {
      toast.error("URL deve começar com https://script.google.com/");
      return false;
    }
    if (!trimmedToken) {
      toast.error("Token não pode ficar vazio");
      return false;
    }
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({ sheet_url: trimmedUrl, sync_token: trimmedToken })
      .eq("id", projectId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (!silent) toast.success("Configuração salva");
    onSaved({ sheet_url: trimmedUrl, sync_token: trimmedToken });
    return true;
  };

  const handleValidate = async () => {
    if (!projectId) return;
    if (!trimmedUrl) {
      toast.error("Cole a URL do Web App primeiro");
      return;
    }
    setValidation({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("pull-sheet", {
        body: {
          projectId,
          validateOnly: true,
          sheetUrlOverride: trimmedUrl,
          syncTokenOverride: trimmedToken,
        },
      });
      if (error) throw error;
      if (data?.ok === false) {
        const d = data.diagnostic ?? {};
        setValidation({
          kind: "error",
          stage: d.stage ?? "unknown",
          message: d.message ?? "Falha desconhecida",
          hint: d.hint,
        });
        return;
      }
      setValidation({
        kind: "ok",
        message: "Conexão OK — Apps Script respondeu CSV.",
        preview: data.preview,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao validar";
      setValidation({ kind: "error", stage: "exception", message: msg });
    }
  };

  const handleSync = async () => {
    if (!projectId) return;
    if (!trimmedUrl) {
      toast.error("Configure a URL antes de sincronizar");
      return;
    }
    setSyncing(true);
    try {
      // Se tem mudanças não salvas, salva primeiro
      if (isDirty) {
        const ok = await handleSave(true);
        if (!ok) {
          setSyncing(false);
          return;
        }
      }
      const { data, error } = await supabase.functions.invoke("pull-sheet", {
        body: { projectId },
      });
      if (error) throw error;
      if (data?.ok === false) {
        const d = data.diagnostic ?? {};
        setValidation({
          kind: "error",
          stage: d.stage ?? "unknown",
          message: d.message ?? "Falha ao sincronizar",
          hint: d.hint,
        });
        return;
      }
      if (data?.error) throw new Error(data.error);
      toast.success("Planilha sincronizada");
      onSynced();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao sincronizar";
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleReset = async () => {
    if (
      !confirm(
        "Gerar novo token e limpar a URL salva? Você vai precisar republicar o Apps Script com o novo token.",
      )
    )
      return;
    setUrl("");
    setToken(genToken());
    setValidation({ kind: "idle" });
    if (projectId) {
      await supabase
        .from("projects")
        .update({ sheet_url: null, sync_token: null })
        .eq("id", projectId);
      onSaved({ sheet_url: "", sync_token: "" });
    }
    toast.info(
      "Token novo gerado. Cole o código atualizado no Apps Script, republique e cole a nova URL aqui.",
    );
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  const lastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("pt-BR")
    : "Nunca";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sincronização com Google Sheets</DialogTitle>
          <DialogDescription>
            Conecte sua planilha via Apps Script para puxar os dados sem
            precisar fazer upload do CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Passo 1 */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              Passo 1 — Cole este código no Apps Script da sua planilha
            </Label>
            <div className="relative">
              <Textarea
                readOnly
                value={appsScriptCode}
                className="font-mono text-[11px] min-h-[220px] resize-none"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(appsScriptCode, "Código")}
                className="absolute top-2 right-2 h-7 gap-1.5"
              >
                <Copy className="w-3 h-3" />
                Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Na planilha: <strong>Extensões → Apps Script</strong> →{" "}
              <strong>apague tudo</strong> → cole o código →{" "}
              <strong>Salvar</strong> → <strong>Implantar → Nova implantação</strong>{" "}
              (ou Gerenciar implantações → Nova versão) → Tipo:{" "}
              <strong>App da Web</strong> → Quem tem acesso:{" "}
              <strong>Qualquer pessoa</strong> → Implantar → copie a URL.
            </p>
          </div>

          {/* Passo 2 */}
          <div className="space-y-2">
            <Label htmlFor="sheet-url" className="text-sm font-semibold">
              Passo 2 — Cole a URL do Web App aqui
            </Label>
            <Input
              id="sheet-url"
              placeholder="https://script.google.com/macros/s/AKfy.../exec"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {/* Token */}
          <div className="space-y-2">
            <Label htmlFor="sync-token" className="text-sm font-semibold">
              Token de segurança
            </Label>
            <div className="flex gap-2">
              <Input
                id="sync-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToken(genToken())}
                title="Gerar novo token"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Esse token deve ser <strong>idêntico</strong> ao que está na constante{" "}
              <code>TOKEN</code> do Apps Script.
            </p>
          </div>

          {/* URL final de teste */}
          {testUrl && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                URL final usada no teste
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={testUrl}
                  className="font-mono text-[11px] bg-muted"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(testUrl, "URL")}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Aviso de não salvo */}
          {isDirty && (initialUrl || initialToken) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>
                Você tem alterações <strong>ainda não salvas</strong>. Clique em{" "}
                <strong>Salvar</strong> ou <strong>Salvar e sincronizar</strong>{" "}
                para aplicar.
              </span>
            </div>
          )}

          {/* Resultado da validação */}
          {validation.kind === "loading" && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Testando conexão com o Apps Script...
            </div>
          )}
          {validation.kind === "ok" && (
            <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                {validation.message}
              </div>
              {validation.preview && (
                <div className="space-y-1">
                  <div className="text-muted-foreground">
                    {validation.preview.lineCount} linhas ·{" "}
                    {validation.preview.totalBytes} bytes
                  </div>
                  <pre className="bg-background/60 rounded p-2 text-[10px] overflow-x-auto max-h-32">
                    {validation.preview.firstLines.join("\n")}
                  </pre>
                </div>
              )}
            </div>
          )}
          {validation.kind === "error" && (
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-destructive">
                <AlertCircle className="w-4 h-4" />
                {validation.message}
              </div>
              {validation.hint && (
                <p className="text-muted-foreground pl-6">{validation.hint}</p>
              )}
              <p className="text-[10px] text-muted-foreground pl-6 opacity-70">
                stage: {validation.stage}
              </p>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t pt-3">
            Última sincronização: <strong>{lastSync}</strong>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="gap-1.5 mr-auto text-destructive hover:text-destructive"
            title="Gerar novo token e limpar URL salva"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Reconfigurar do zero
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleValidate}
            disabled={!trimmedUrl || validation.kind === "loading"}
            className="gap-1.5"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Testar conexão
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={saving || !isDirty}
          >
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button
            onClick={handleSync}
            disabled={syncing || !trimmedUrl}
            className={cn("gap-2")}
          >
            <RefreshCw
              className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing
              ? "Sincronizando..."
              : isDirty
                ? "Salvar e sincronizar"
                : "Sincronizar agora"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

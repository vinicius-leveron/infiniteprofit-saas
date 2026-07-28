import { useMemo, useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";

export function HotmartBackfillDialog({
  workspaceId,
  projectId,
  integrationId,
}: {
  workspaceId: string;
  projectId: string;
  integrationId: string;
}) {
  const defaults = useMemo(() => defaultRange(), []);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function enqueue() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("hotmart-sync", {
        body: {
          action: "enqueue_backfill",
          workspace_id: workspaceId,
          project_id: projectId,
          integration_id: integrationId,
          start_date: startDate,
          end_date: endDate,
        },
      });
      if (error) {
        throw new Error(
          await edgeFunctionErrorMessage(
            error,
            "Não foi possível iniciar o histórico Hotmart.",
          ),
        );
      }
      if (data?.ok === false) throw new Error(data.error);
      setOpen(false);
      toast.success(
        `${data?.range?.totalDays ?? "O"} dia(s) de histórico entraram na fila.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Falha ao iniciar o histórico Hotmart.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-11 gap-2">
          <CalendarRange className="h-4 w-4" aria-hidden="true" />
          Importar histórico
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar histórico da Hotmart</DialogTitle>
          <DialogDescription>
            O intervalo será processado em janelas idempotentes. O limite por
            solicitação é de 365 dias.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hotmart-backfill-start">Data inicial</Label>
            <Input
              id="hotmart-backfill-start"
              type="date"
              value={startDate}
              max={endDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hotmart-backfill-end">Data final</Label>
            <Input
              id="hotmart-backfill-end"
              type="date"
              value={endDate}
              min={startDate}
              max={defaults.endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          {errorMessage ? (
            <p
              className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive sm:col-span-2"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            className="min-h-11 gap-2"
            disabled={submitting || !startDate || !endDate}
            onClick={() => void enqueue()}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarRange className="h-4 w-4" aria-hidden="true" />
            )}
            Iniciar importação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 89);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

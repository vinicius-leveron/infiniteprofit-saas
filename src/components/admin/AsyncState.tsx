import type { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AsyncStatus = "loading" | "ready" | "empty" | "error";

interface AsyncStateProps {
  status: AsyncStatus;
  children: ReactNode;
  errorMessage?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRetry?: () => void;
}

export function AsyncState({
  status,
  children,
  errorMessage = "Não foi possível carregar esta página.",
  emptyTitle = "Nada por aqui ainda",
  emptyDescription = "Os dados aparecerão aqui quando estiverem disponíveis.",
  emptyAction,
  onRetry,
}: AsyncStateProps) {
  if (status === "loading") {
    return (
      <Card aria-live="polite">
        <CardContent className="flex min-h-40 items-center justify-center p-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Carregando…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="border-destructive/30" role="alert">
        <CardContent className="flex min-h-40 flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="mb-3 h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="max-w-xl text-sm text-muted-foreground">{errorMessage}</p>
          {onRetry && (
            <Button className="mt-4 min-h-11 gap-2" variant="outline" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Tentar novamente
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (status === "empty") {
    return (
      <Card>
        <CardContent className="flex min-h-52 flex-col items-center justify-center p-6 text-center md:p-8">
          <Inbox className="mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold leading-7">{emptyTitle}</h2>
          <p className="mt-1 max-w-md text-sm leading-5 text-muted-foreground">
            {emptyDescription}
          </p>
          {emptyAction && <div className="mt-5">{emptyAction}</div>}
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}

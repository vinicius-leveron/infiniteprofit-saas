import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Waypoints,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClientFunnels } from "@/hooks/useClientFunnels";
import {
  buildDashboardDestination,
  writeLastDashboardPreference,
} from "@/lib/lastDashboard";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface FunnelSwitcherProps {
  clientId: string | null;
  funnelId: string | null;
  canManageClient: boolean;
  compact?: boolean;
  onSelect?: () => void;
}

export function FunnelSwitcher({
  clientId,
  funnelId,
  canManageClient,
  compact = false,
  onSelect,
}: FunnelSwitcherProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const lastRefetchedFunnelId = useRef<string | null>(null);
  const {
    data: funnels = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useClientFunnels(clientId);

  const currentFunnel = funnels.find((funnel) => funnel.id === funnelId) ?? null;

  useEffect(() => {
    if (
      !funnelId ||
      isLoading ||
      isFetching ||
      currentFunnel ||
      lastRefetchedFunnelId.current === funnelId
    ) {
      return;
    }
    lastRefetchedFunnelId.current = funnelId;
    void refetch();
  }, [currentFunnel, funnelId, isFetching, isLoading, refetch]);

  const selectFunnel = (selectedFunnelId: string) => {
    if (!clientId || !user?.id) return;
    writeLastDashboardPreference({
      userId: user.id,
      clientId,
      funnelId: selectedFunnelId,
      dashboardTab: "geral",
    });
    setOpen(false);
    onSelect?.();
    navigate(buildDashboardDestination(selectedFunnelId));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!clientId}
          aria-label={
            currentFunnel
              ? `Trocar funil. Atual: ${currentFunnel.name}`
              : "Selecionar funil"
          }
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            compact ? "h-10 w-10 justify-center px-0 sm:w-[190px] sm:justify-start sm:px-3" : "h-10 w-[240px] px-3",
          )}
        >
          <Waypoints className="h-4 w-4 shrink-0 text-primary" />
          <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", compact && "hidden sm:block")}>
            {currentFunnel?.name ?? (isLoading ? "Carregando funis…" : "Selecionar funil")}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground", compact && "hidden sm:block")} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-xl border-border/80 p-0 shadow-xl"
      >
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Funis do cliente
          </p>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando funis…
            </div>
          ) : isError ? (
            <div className="px-3 py-5 text-center">
              <p className="text-sm text-muted-foreground">
                Não foi possível carregar os funis.
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </button>
            </div>
          ) : funnels.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhum funil criado neste cliente.
            </p>
          ) : (
            funnels.map((funnel) => {
              const active = funnel.id === funnelId;
              return (
                <button
                  key={funnel.id}
                  type="button"
                  onClick={() => selectFunnel(funnel.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Waypoints className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{funnel.name}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>

        {canManageClient && clientId && (
          <div className="border-t border-border/60 p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect?.();
                navigate(`/clients/${clientId}/funnels/new`);
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" />
              Criar novo funil
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

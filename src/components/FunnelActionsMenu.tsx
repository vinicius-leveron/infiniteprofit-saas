import { useNavigate } from "react-router-dom";
import { MoreHorizontal, Waypoints } from "lucide-react";
import { createAppNavigation } from "@/components/app-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface FunnelActionsMenuProps {
  clientId: string | null;
  funnelId: string | null;
  canManageOrganization: boolean;
  canManageClient: boolean;
}

export function FunnelActionsMenu({
  clientId,
  funnelId,
  canManageOrganization,
  canManageClient,
}: FunnelActionsMenuProps) {
  const navigate = useNavigate();
  const items = createAppNavigation({
    clientId,
    funnelId,
    canManageOrganization,
    canManageClient,
    surface: "funnel",
  })
    .flatMap((group) => group.items)
    .filter((item) => item.id !== "funnel-dashboard");

  if (!funnelId) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="Abrir ações do funil"
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Operação do funil
        </DropdownMenuLabel>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => navigate(item.href)}
              className="min-h-11 gap-3"
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            navigate(clientId ? `/clients/${clientId}/funnels` : "/clients")
          }
          className="min-h-11 gap-3"
        >
          <Waypoints className="h-4 w-4 text-muted-foreground" />
          Ver todos os funis
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

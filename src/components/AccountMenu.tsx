import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronUp, Command, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  createAppNavigation,
  isAppNavigationItemActive,
  type AppNavigationGroup,
  type AppNavigationItem,
} from "@/components/app-navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AccountMenuProps {
  variant: "sidebar" | "mobile";
  clientId: string | null;
  clientName: string | null;
  funnelId: string | null;
  canManageOrganization: boolean;
  canManageClient: boolean;
  onOpenCommand: () => void;
  onNavigate?: () => void;
}

function getUserIdentity(user: ReturnType<typeof useAuth>["user"]) {
  const metadataName =
    typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user?.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null;
  const email = user?.email ?? "";
  const name = metadataName || email.split("@")[0] || "Minha conta";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return { name, email, initials: initials || "IP" };
}

function groupLabel(group: AppNavigationGroup, clientName: string | null) {
  return group.id === "client" && clientName
    ? `Cliente · ${clientName}`
    : group.label;
}

export function AccountMenu({
  variant,
  clientId,
  clientName,
  funnelId,
  canManageOrganization,
  canManageClient,
  onOpenCommand,
  onNavigate,
}: AccountMenuProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const identity = getUserIdentity(user);
  const groups = createAppNavigation({
    clientId,
    funnelId,
    canManageOrganization,
    canManageClient,
    surface: "account-menu",
  });

  const navigateTo = (item: AppNavigationItem) => {
    setMobileOpen(false);
    onNavigate?.();
    navigate(item.href);
  };

  const openCommand = () => {
    setMobileOpen(false);
    onNavigate?.();
    onOpenCommand();
  };

  const signOut = async () => {
    setMobileOpen(false);
    onNavigate?.();
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  if (variant === "mobile") {
    return (
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerTrigger asChild>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Abrir menu da conta"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                {identity.initials}
              </AvatarFallback>
            </Avatar>
          </button>
        </DrawerTrigger>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader className="border-b border-border/60 text-left">
            <DrawerTitle>{identity.name}</DrawerTitle>
            <DrawerDescription>{identity.email}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-3 pb-6 pt-2">
            {groups.map((group) => (
              <section key={group.id} className="py-2">
                <h2 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  {groupLabel(group, clientName)}
                </h2>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isAppNavigationItemActive(
                    item,
                    location.pathname,
                    location.search,
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateTo(item)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </section>
            ))}
            <div className="my-2 h-px bg-border/60" />
            <button
              type="button"
              onClick={openCommand}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Command className="h-4 w-4" />
              <span>Buscar comandos</span>
              <kbd className="ml-auto text-[10px]">⌘K</kbd>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Abrir menu da conta"
        >
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
              {identity.initials}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">
              {identity.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {identity.email}
            </span>
          </span>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={12}
        collisionPadding={12}
        className="max-h-[calc(100vh-24px)] w-72 overflow-y-auto"
      >
        <DropdownMenuLabel>
          <span className="block truncate text-sm">{identity.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {identity.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((group, index) => (
          <div key={group.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.13em] text-muted-foreground">
              {groupLabel(group, clientName)}
            </DropdownMenuLabel>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isAppNavigationItemActive(
                item,
                location.pathname,
                location.search,
              );
              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => navigateTo(item)}
                  className={cn("min-h-10 gap-3", active && "bg-primary/10")}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openCommand} className="min-h-10 gap-3">
          <Command className="h-4 w-4 text-muted-foreground" />
          Buscar comandos
          <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()} className="min-h-10 gap-3">
          <LogOut className="h-4 w-4 text-muted-foreground" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3,
  Radio,
  Target,
  Gift,
  Stethoscope,
  FileSpreadsheet,
  Calendar,
  Plus,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import type { Period } from "./PeriodFilter";
import { useWorkspace } from "@/hooks/useWorkspace";

interface ProjectMini {
  id: string;
  name: string;
  file_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Quando passado, mostra ações específicas do dashboard */
  onSelectTab?: (tab: "geral" | "trafego" | "funil" | "bumps" | "diagnostico") => void;
  onSelectPeriod?: (p: Period) => void;
}

export const CommandPalette = ({ open, onOpenChange, onSelectTab, onSelectPeriod }: Props) => {
  const navigate = useNavigate();
  const { currentWorkspaceId, isOrganizationAdmin } = useWorkspace();
  const [projects, setProjects] = useState<ProjectMini[]>([]);

  useEffect(() => {
    if (!open || !currentWorkspaceId) return;
    void supabase
      .from("projects")
      .select("id, name, file_name")
      .eq("workspace_id", currentWorkspaceId)
      .order("updated_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setProjects(data ?? []));
  }, [currentWorkspaceId, open]);

  const close = () => onOpenChange(false);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar projeto, aba ou ação..." />
      <CommandList>
        <CommandEmpty>Nada encontrado</CommandEmpty>

        {onSelectTab && (
          <>
            <CommandGroup heading="Abas">
              <CommandItem onSelect={run(() => onSelectTab("geral"))}>
                <BarChart3 className="w-4 h-4 mr-2" />
                Visão Geral
                <span className="ml-auto text-[10px] text-muted-foreground">1</span>
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectTab("trafego"))}>
                <Radio className="w-4 h-4 mr-2" />
                Tráfego
                <span className="ml-auto text-[10px] text-muted-foreground">2</span>
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectTab("funil"))}>
                <Target className="w-4 h-4 mr-2" />
                Funil VSL
                <span className="ml-auto text-[10px] text-muted-foreground">3</span>
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectTab("bumps"))}>
                <Gift className="w-4 h-4 mr-2" />
                Bumps &amp; Upsell
                <span className="ml-auto text-[10px] text-muted-foreground">4</span>
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectTab("diagnostico"))}>
                <Stethoscope className="w-4 h-4 mr-2" />
                Diagnóstico
                <span className="ml-auto text-[10px] text-muted-foreground">5</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {onSelectPeriod && (
          <>
            <CommandGroup heading="Período">
              <CommandItem onSelect={run(() => onSelectPeriod("7d"))}>
                <Calendar className="w-4 h-4 mr-2" /> Últimos 7 dias
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectPeriod("15d"))}>
                <Calendar className="w-4 h-4 mr-2" /> Últimos 15 dias
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectPeriod("30d"))}>
                <Calendar className="w-4 h-4 mr-2" /> Últimos 30 dias
              </CommandItem>
              <CommandItem onSelect={run(() => onSelectPeriod("all"))}>
                <Calendar className="w-4 h-4 mr-2" /> Tudo
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Projetos">
          <CommandItem onSelect={run(() => navigate("/projects"))}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Ver todos os projetos
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/dashboard"))}>
            <Plus className="w-4 h-4 mr-2" />
            Novo projeto (CSV)
          </CommandItem>
          {projects.map((p) => (
            <CommandItem
              key={p.id}
              value={`projeto ${p.name} ${p.file_name ?? ""}`}
              onSelect={run(() => navigate(`/dashboard?project=${p.id}`))}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              <span className="truncate">{p.name}</span>
              {p.file_name && (
                <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[160px]">
                  {p.file_name}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Workspace">
          <CommandItem onSelect={run(() => navigate("/workspace-settings"))}>
            <Users className="w-4 h-4 mr-2" />
            Configurar workspace
          </CommandItem>
          {isOrganizationAdmin && (
            <CommandItem onSelect={run(() => navigate("/organization-settings"))}>
              <Settings className="w-4 h-4 mr-2" />
              Configurar organização
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Conta">
          <CommandItem
            onSelect={run(async () => {
              await supabase.auth.signOut();
              navigate("/auth", { replace: true });
            })}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

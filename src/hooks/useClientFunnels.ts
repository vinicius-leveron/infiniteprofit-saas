import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DashboardFunnelOption } from "@/lib/lastDashboard";

export function useClientFunnels(clientId: string | null) {
  return useQuery({
    queryKey: ["client-funnels", clientId],
    enabled: Boolean(clientId),
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, updated_at")
        .eq("workspace_id", clientId as string)
        .order("updated_at", { ascending: false })
        .abortSignal(signal);

      if (error) throw error;
      return (data ?? []) as DashboardFunnelOption[];
    },
  });
}

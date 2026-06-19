import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { buildAuthRedirect } from "@/lib/authRedirect";

type InviteKind = "organization" | "workspace";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { refreshAccess, setCurrentWorkspaceId } = useWorkspace();
  const [processing, setProcessing] = useState(true);

  const token = searchParams.get("token");
  const kind = (searchParams.get("kind") as InviteKind | null) ?? "workspace";

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) return;

    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("accept-invite", {
          body: { kind, token },
        });
        if (error) throw error;

        await refreshAccess();

        const acceptedId = typeof data?.id === "string" ? data.id : null;
        if (kind === "workspace" && acceptedId) {
          setCurrentWorkspaceId(acceptedId);
        }

        toast.success("Convite aceito");
        navigate(kind === "organization" ? "/organization-settings" : "/projects", { replace: true });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao aceitar convite");
        navigate("/projects", { replace: true });
      } finally {
        if (!cancelled) setProcessing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, kind, navigate, refreshAccess, setCurrentWorkspaceId, token, user]);

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!token) {
    return <Navigate to="/projects" replace />;
  }

  if (!user) {
    return <Navigate to={buildAuthRedirect(`/accept-invite?kind=${kind}&token=${token}`)} replace />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="section-card max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow mx-auto mb-4">
          <MailCheck className="w-6 h-6 text-primary-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-2">Aceitando convite</h1>
        <p className="text-sm text-muted-foreground">
          {processing ? "Validando seu acesso…" : "Redirecionando…"}
        </p>
      </div>
    </main>
  );
}

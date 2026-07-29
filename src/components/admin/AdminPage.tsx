import { useState, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { resolveClientLandingDestination } from "@/lib/lastDashboard";

interface AdminPageProps {
  title: string;
  description: string;
  context?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function AdminPage({
  title,
  description,
  context,
  action,
  children,
}: AdminPageProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentWorkspaceId } = useWorkspace();
  const [returning, setReturning] = useState(false);

  const returnToDashboard = async () => {
    if (!user?.id || !currentWorkspaceId) {
      navigate("/clients");
      return;
    }
    setReturning(true);
    const destination = await resolveClientLandingDestination(
      user.id,
      currentWorkspaceId,
    );
    navigate(destination);
    setReturning(false);
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <Button
        type="button"
        variant="ghost"
        className="-ml-3 mb-4 min-h-11 gap-2 text-muted-foreground"
        disabled={returning}
        onClick={() => void returnToDashboard()}
      >
        {returning ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        )}
        Voltar ao Dashboard
      </Button>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {context && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {context}
            </p>
          )}
          <h1 className="text-2xl font-bold leading-8 text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="space-y-6 md:space-y-8">{children}</div>
    </main>
  );
}

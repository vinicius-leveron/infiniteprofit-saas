import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, CircleAlert, Loader2, MailCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace, type WorkspaceRole } from "@/hooks/useWorkspace";
import { buildAuthRedirect } from "@/lib/authRedirect";

type InviteKind = "organization" | "workspace";

interface InvitePreview {
  targetId: string;
  targetName: string;
  organizationId: string | null;
  organizationName: string | null;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
}

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  moderator: "Moderador",
  member: "Membro",
};

async function inviteErrorMessage(error: unknown) {
  let rawMessage =
    error instanceof Error ? error.message : "Não foi possível validar este convite.";
  const context = (error as { context?: unknown } | null)?.context;

  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string") rawMessage = body.error;
    } catch {
      // Keep the client error when the function did not return a JSON body.
    }
  }

  const message = rawMessage.toLowerCase();
  if (message.includes("not found") || message.includes("expired")) {
    return "Este convite expirou, foi revogado ou já foi utilizado.";
  }
  if (message.includes("email does not match")) {
    return "Este convite foi enviado para outro email. Entre com a conta correta.";
  }
  return rawMessage;
}

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { refreshAccess, setCurrentWorkspaceId } = useWorkspace();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.id ?? null;
  const token = searchParams.get("token");
  const kind: InviteKind =
    searchParams.get("kind") === "organization" ? "organization" : "workspace";

  useEffect(() => {
    if (authLoading || !userId || !token) return;

    sessionStorage.removeItem("infiniteprofit.pendingEmailConfirmation");
    let active = true;
    setLoadingPreview(true);
    setError(null);

    void supabase.functions
      .invoke("accept-invite", {
        body: { action: "preview", kind, token },
      })
      .then(({ data, error: functionError }) => {
        if (!active) return;
        if (functionError) throw functionError;
        if (!data?.invite) throw new Error("Convite inválido");
        setPreview(data.invite as InvitePreview);
      })
      .catch(async (previewError: unknown) => {
        const message = await inviteErrorMessage(previewError);
        if (active) setError(message);
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, kind, token, userId]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);

    try {
      const { data, error: functionError } = await supabase.functions.invoke("accept-invite", {
        body: { action: "accept", kind, token },
      });
      if (functionError) throw functionError;

      await refreshAccess();
      const acceptedId = typeof data?.id === "string" ? data.id : preview?.targetId ?? null;

      if (kind === "workspace" && acceptedId) {
        setCurrentWorkspaceId(acceptedId);
        navigate(`/clients/${acceptedId}/funnels`, { replace: true });
      } else {
        navigate("/clients", { replace: true });
      }
    } catch (acceptError) {
      setError(await inviteErrorMessage(acceptError));
      setAccepting(false);
    }
  };

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center" aria-label="Carregando convite">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!token) {
    return (
      <InviteError
        message="O link deste convite está incompleto. Solicite um novo convite."
        onBack={() => navigate("/clients", { replace: true })}
      />
    );
  }

  if (!user) {
    const invitePath = `/accept-invite?kind=${kind}&token=${encodeURIComponent(token)}`;
    return <Navigate to={buildAuthRedirect(invitePath)} replace />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <section className="section-card max-w-md w-full" aria-labelledby="invite-title">
        <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow mb-5">
          <MailCheck className="w-6 h-6 text-primary-foreground" aria-hidden="true" />
        </div>

        <h1 id="invite-title" className="text-xl font-semibold text-foreground mb-2">
          Revise seu convite
        </h1>

        {loadingPreview ? (
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            Validando convite…
          </div>
        ) : error || !preview ? (
          <>
            <Alert variant="destructive" className="mt-5">
              <CircleAlert className="w-4 h-4" aria-hidden="true" />
              <AlertDescription>{error ?? "Não foi possível carregar este convite."}</AlertDescription>
            </Alert>
            <Button
              type="button"
              variant="outline"
              className="w-full min-h-11 mt-5"
              onClick={() => navigate("/clients", { replace: true })}
            >
              Voltar
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Confirme os dados antes de entrar. O acesso só será concedido depois da sua
              confirmação.
            </p>

            <dl className="mt-6 space-y-4">
              {kind === "workspace" && preview.organizationName && (
                <div className="flex gap-3">
                  <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-muted-foreground">Organização</dt>
                    <dd className="text-sm font-medium text-foreground">
                      {preview.organizationName}
                    </dd>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Users className="w-5 h-5 text-muted-foreground mt-0.5" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {kind === "organization" ? "Organização" : "Cliente"}
                  </dt>
                  <dd className="text-sm font-medium text-foreground">{preview.targetName}</dd>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Papel</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {ROLE_LABEL[preview.role] ?? preview.role}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Válido até</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {new Intl.DateTimeFormat("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    }).format(new Date(preview.expiresAt))}
                  </dd>
                </div>
              </div>
            </dl>

            {error && (
              <Alert variant="destructive" className="mt-5">
                <CircleAlert className="w-4 h-4" aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-3 mt-6">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => navigate("/clients", { replace: true })}
                disabled={accepting}
              >
                Agora não
              </Button>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => void handleAccept()}
                disabled={accepting}
              >
                {accepting && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                )}
                Aceitar convite
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function InviteError({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <section className="section-card max-w-md w-full" aria-labelledby="invite-error-title">
        <h1 id="invite-error-title" className="text-xl font-semibold mb-4">
          Convite inválido
        </h1>
        <Alert variant="destructive">
          <CircleAlert className="w-4 h-4" aria-hidden="true" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" className="w-full min-h-11 mt-5" onClick={onBack}>
          Voltar
        </Button>
      </section>
    </main>
  );
}

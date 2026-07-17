import { Copy, Link2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/admin/StatusPill";

export interface AdminInvite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
}

interface InviteListProps {
  invites: AdminInvite[];
  kind: "organization" | "workspace";
  canManage: boolean;
  onCopy: (url: string) => void;
  onRenew: (invite: AdminInvite) => void;
  onRevoke: (invite: AdminInvite) => void;
  renewingId?: string | null;
  revokingId?: string | null;
}

function getInviteStatus(invite: AdminInvite) {
  if (invite.accepted_at) return { label: "Aceito", tone: "success" as const };
  if (invite.revoked_at) return { label: "Revogado", tone: "neutral" as const };
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    return { label: "Expirado", tone: "warning" as const };
  }
  return { label: "Pendente", tone: "info" as const };
}

function formatExpiration(value: string | null) {
  if (!value) return "Sem expiração informada";
  return `Expira em ${new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value))}`;
}

export function InviteList({
  invites,
  kind,
  canManage,
  onCopy,
  onRenew,
  onRevoke,
  renewingId,
  revokingId,
}: InviteListProps) {
  if (invites.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhum convite emitido.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {invites.map((invite) => {
        const status = getInviteStatus(invite);
        const active = status.label === "Pendente";
        const url = `${window.location.origin}/accept-invite?kind=${kind}&token=${invite.token}`;

        return (
          <Card key={invite.id}>
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{invite.email}</p>
                  <StatusPill label={status.label} tone={status.tone} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {invite.role} · {formatExpiration(invite.expires_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {active && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-2"
                    onClick={() => onCopy(url)}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copiar link
                  </Button>
                )}
                {canManage && !invite.accepted_at && (
                  <>
                    {!active && (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 gap-2"
                        disabled={renewingId === invite.id}
                        onClick={() => onRenew(invite)}
                      >
                        {renewingId === invite.id ? (
                          <RotateCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Link2 className="h-4 w-4" aria-hidden="true" />
                        )}
                        Renovar
                      </Button>
                    )}
                    {!invite.revoked_at && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 gap-2 text-destructive hover:text-destructive"
                        disabled={revokingId === invite.id}
                        onClick={() => onRevoke(invite)}
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        Revogar
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

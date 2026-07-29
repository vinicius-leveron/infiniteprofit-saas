import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Loader2, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MemberIdentity } from "@/components/admin/MemberIdentity";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface TeamMember {
  userId: string;
  role: string;
  accessOrigin: "workspace" | "organization";
  email?: string | null;
  fullName?: string | null;
  inherited?: boolean;
}

interface TeamMemberListProps {
  members: TeamMember[];
  currentUser: User | null;
  emptyMessage: string;
  canManage?: boolean;
  canGrantOwner?: boolean;
  availableRoles?: string[];
  busyUserId?: string | null;
  onUpdateRole?: (member: TeamMember, role: string) => void;
  onRemove?: (member: TeamMember) => void;
}

const roleLabels: Record<string, string> = {
  owner: "Administrador principal",
  admin: "Admin",
  moderator: "Membro",
  member: "Membro",
};

export function TeamMemberList({
  members,
  currentUser,
  emptyMessage,
  canManage = false,
  canGrantOwner = false,
  availableRoles = ["admin", "member"],
  busyUserId,
  onUpdateRole,
  onRemove,
}: TeamMemberListProps) {
  const [pendingRemoval, setPendingRemoval] = useState<TeamMember | null>(null);
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {members.map((member) => {
        const canEdit =
          canManage &&
          !member.inherited &&
          member.role !== "owner";
        const selectableRoles = availableRoles.filter(
          (role) => role !== "owner" || canGrantOwner,
        );
        const busy = busyUserId === member.userId;

        return (
        <Card key={`${member.accessOrigin}-${member.userId}`}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <MemberIdentity
              userId={member.userId}
              currentUser={currentUser}
              email={member.email}
              fullName={member.fullName}
            />
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {canEdit && onUpdateRole ? (
                <Select
                  value={member.role}
                  disabled={busy}
                  onValueChange={(role) => onUpdateRole(member, role)}
                >
                  <SelectTrigger
                    className="min-h-11 w-[148px]"
                    aria-label={`Alterar papel de ${member.fullName || member.email || member.userId}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {roleLabels[role] ?? role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <StatusPill
                  label={roleLabels[member.role] ?? member.role}
                  tone={member.role === "owner" ? "success" : "neutral"}
                />
              )}
              <StatusPill
                label={
                  member.accessOrigin === "organization"
                    ? "Via organização"
                    : "Acesso direto"
                }
                tone={member.accessOrigin === "organization" ? "info" : "neutral"}
              />
              {canEdit && onRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => setPendingRemoval(member)}
                  aria-label={`Remover ${member.fullName || member.email || "membro"}`}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        );
      })}

      <AlertDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval?.fullName || pendingRemoval?.email || "Esta pessoa"} perderá
              o acesso direto a este escopo. A ação ficará registrada na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingRemoval) onRemove?.(pendingRemoval);
                setPendingRemoval(null);
              }}
            >
              Remover acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

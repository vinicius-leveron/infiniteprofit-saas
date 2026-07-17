import { UserRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";

interface MemberIdentityProps {
  userId: string;
  currentUser: User | null;
  email?: string | null;
  fullName?: string | null;
}

export function MemberIdentity({
  userId,
  currentUser,
  email,
  fullName,
}: MemberIdentityProps) {
  const isCurrentUser = currentUser?.id === userId;
  const primary = fullName || email || (isCurrentUser ? currentUser?.email : null) || "Usuário";
  const secondary = isCurrentUser
    ? `${currentUser?.email ?? "Conta atual"} · você`
    : email || "Identidade indisponível";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UserRound className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
    </div>
  );
}

import type { User } from "@supabase/supabase-js";
import { Card, CardContent } from "@/components/ui/card";
import { MemberIdentity } from "@/components/admin/MemberIdentity";
import { StatusPill } from "@/components/admin/StatusPill";

export interface TeamMember {
  userId: string;
  role: string;
  accessOrigin: "workspace" | "organization";
  email?: string | null;
  fullName?: string | null;
}

interface TeamMemberListProps {
  members: TeamMember[];
  currentUser: User | null;
  emptyMessage: string;
}

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Moderador",
  member: "Membro",
};

export function TeamMemberList({
  members,
  currentUser,
  emptyMessage,
}: TeamMemberListProps) {
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {members.map((member) => (
        <Card key={`${member.accessOrigin}-${member.userId}`}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <MemberIdentity
              userId={member.userId}
              currentUser={currentUser}
              email={member.email}
              fullName={member.fullName}
            />
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <StatusPill
                label={roleLabels[member.role] ?? member.role}
                tone={member.role === "owner" ? "success" : "neutral"}
              />
              <StatusPill
                label={
                  member.accessOrigin === "organization"
                    ? "Via organização"
                    : "Acesso direto"
                }
                tone={member.accessOrigin === "organization" ? "info" : "neutral"}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

import { supabase } from "@/integrations/supabase/client";

export type TeamAccessScope = "organization" | "workspace";
export type TeamAccessAction =
  | "create_invite"
  | "resend_invite"
  | "revoke_invite"
  | "update_member_role"
  | "remove_member";

interface TeamAccessRequest {
  scope_type: TeamAccessScope;
  scope_id: string;
  action: TeamAccessAction;
  email?: string;
  role?: string;
  invite_id?: string;
  user_id?: string;
}

export interface TeamAccessResult {
  ok: boolean;
  invite_id?: string;
  user_id?: string;
  role?: string;
  expires_at?: string;
  delivery?: {
    status: "sent" | "failed";
    error: string | null;
  };
}

export async function runTeamAccess(
  request: TeamAccessRequest,
): Promise<TeamAccessResult> {
  const { data, error } = await supabase.functions.invoke("team-access", {
    body: request,
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data as TeamAccessResult;
}

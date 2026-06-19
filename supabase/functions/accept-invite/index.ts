/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

type InviteKind = "organization" | "workspace";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user?.id || !user.email) {
      return json({ error: "Not authenticated" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const token = stringOrNull(body.token);
    const kind = normalizeKind(body.kind);
    if (!token) {
      return json({ error: "Token obrigatorio" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const id = kind === "organization"
      ? await acceptOrganizationInvite(admin, token, user.id, user.email)
      : await acceptWorkspaceInvite(admin, token, user.id, user.email);

    return json({ ok: true, kind, id });
  } catch (error) {
    console.error("accept-invite error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function acceptOrganizationInvite(
  admin: SupabaseClientAny,
  token: string,
  userId: string,
  userEmail: string,
) {
  const { data: invite, error } = await admin
    .from("organization_invites")
    .select("id, organization_id, email, role")
    .eq("token", token)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(error.message);
  const typedInvite = invite as {
    id: string;
    organization_id: string;
    email: string;
    role: string;
  } | null;
  if (!typedInvite?.organization_id) throw new Error("Invite not found or expired");
  assertInviteEmail(typedInvite.email, userEmail);

  const { error: memberError } = await admin
    .from("organization_members")
    .upsert(
      {
        organization_id: typedInvite.organization_id,
        user_id: userId,
        role: typedInvite.role,
      },
      { onConflict: "organization_id,user_id" },
    );
  if (memberError) throw new Error(memberError.message);

  const { error: updateError } = await admin
    .from("organization_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", typedInvite.id);
  if (updateError) throw new Error(updateError.message);

  return typedInvite.organization_id;
}

async function acceptWorkspaceInvite(
  admin: SupabaseClientAny,
  token: string,
  userId: string,
  userEmail: string,
) {
  const { data: invite, error } = await admin
    .from("workspace_invites")
    .select("id, workspace_id, email, role")
    .eq("token", token)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(error.message);
  const typedInvite = invite as {
    id: string;
    workspace_id: string;
    email: string;
    role: string;
  } | null;
  if (!typedInvite?.workspace_id) throw new Error("Invite not found or expired");
  assertInviteEmail(typedInvite.email, userEmail);

  const { error: memberError } = await admin
    .from("workspace_members")
    .upsert(
      {
        workspace_id: typedInvite.workspace_id,
        user_id: userId,
        role: typedInvite.role,
      },
      { onConflict: "workspace_id,user_id" },
    );
  if (memberError) throw new Error(memberError.message);

  const { error: updateError } = await admin
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", typedInvite.id);
  if (updateError) throw new Error(updateError.message);

  return typedInvite.workspace_id;
}

function assertInviteEmail(inviteEmail: unknown, userEmail: string) {
  if (String(inviteEmail ?? "").trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
    throw new Error("Invite email does not match current user");
  }
}

function normalizeKind(value: unknown): InviteKind {
  return value === "organization" ? "organization" : "workspace";
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

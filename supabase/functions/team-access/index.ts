/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  canGrantRole,
  highestEffectiveAccess,
  type EffectiveRole,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_PUBLIC_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") ??
  "Infinite Profit <acesso@auth.infiniteprofit.com.br>";

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;
type ScopeType = "organization" | "workspace";
type TeamAction =
  | "create_invite"
  | "resend_invite"
  | "revoke_invite"
  | "update_member_role"
  | "remove_member";

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let action: TeamAction | null = null;
  let scopeType: ScopeType | null = null;
  let scopeId: string | null = null;

  try {
    const caller = await resolveUser(req.headers.get("Authorization"));
    if (!caller) throw new HttpError("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    action = normalizeAction(body.action);
    scopeType = normalizeScopeType(body.scope_type);
    scopeId = requiredUuid(body.scope_id, "scope_id");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const access = await resolveEffectiveAccess(
      admin,
      scopeType,
      scopeId,
      caller.userId,
    );
    assertManager(access.role);

    switch (action) {
      case "create_invite":
        return json(await createInvite(admin, body, scopeType, scopeId, caller.userId, access.role));
      case "resend_invite":
        return json(await resendInvite(admin, body, scopeType, scopeId, caller.userId, access.role));
      case "revoke_invite":
        return json(await revokeInvite(admin, body, scopeType, scopeId, caller.userId, access.role));
      case "update_member_role":
        return json(await updateMemberRole(admin, body, scopeType, scopeId, caller.userId, access.role));
      case "remove_member":
        return json(await removeMember(admin, body, scopeType, scopeId, caller.userId, access.role));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    console.error(JSON.stringify({
      event: "team_access_failed",
      action,
      scope_type: scopeType,
      scope_id: scopeId,
      error: sanitizeOperationalError(message),
    }));
    return json(
      { error: message },
      error instanceof HttpError ? error.status : 500,
    );
  }
});

async function createInvite(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  scopeType: ScopeType,
  scopeId: string,
  actorUserId: string,
  actorRole: EffectiveRole,
) {
  const email = normalizeEmail(body.email);
  const role = normalizeRole(body.role, scopeType);
  assertCanGrantRole(actorRole, role);

  const table = inviteTable(scopeType);
  const scopeColumn = inviteScopeColumn(scopeType);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: existing, error: existingError } = await admin
    .from(table)
    .select("id, token")
    .eq(scopeColumn, scopeId)
    .ilike("email", email)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let invite: { id: string; token: string };
  if (existing) {
    const { data, error } = await admin
      .from(table)
      .update({
        role,
        expires_at: expiresAt,
        revoked_at: null,
        delivery_status: "pending",
        delivery_error: null,
      })
      .eq("id", existing.id)
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    invite = data;
  } else {
    const { data, error } = await admin
      .from(table)
      .insert({
        [scopeColumn]: scopeId,
        email,
        role,
        created_by: actorUserId,
        expires_at: expiresAt,
        delivery_status: "pending",
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    invite = data;
  }

  const delivery = await deliverInvite({
    admin,
    table,
    inviteId: invite.id,
    token: invite.token,
    kind: scopeType,
    email,
    expiresAt,
    scopeName: await scopeName(admin, scopeType, scopeId),
  });

  await audit(admin, {
    scopeType,
    scopeId,
    action: "invite_created",
    actorUserId,
    subjectInviteId: invite.id,
    nextRole: role,
    metadata: { delivery_status: delivery.status },
  });

  return {
    ok: true,
    invite_id: invite.id,
    expires_at: expiresAt,
    delivery,
  };
}

async function resendInvite(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  scopeType: ScopeType,
  scopeId: string,
  actorUserId: string,
  actorRole: EffectiveRole,
) {
  const inviteId = requiredUuid(body.invite_id, "invite_id");
  const table = inviteTable(scopeType);
  const scopeColumn = inviteScopeColumn(scopeType);
  const { data: invite, error } = await admin
    .from(table)
    .select("id, token, email, role, accepted_at")
    .eq("id", inviteId)
    .eq(scopeColumn, scopeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) throw new HttpError("Convite não encontrado.", 404);
  if (invite.accepted_at) throw new HttpError("Este convite já foi aceito.", 409);
  assertCanGrantRole(actorRole, normalizeRole(invite.role, scopeType));

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: updateError } = await admin
    .from(table)
    .update({
      expires_at: expiresAt,
      revoked_at: null,
      delivery_status: "pending",
      delivery_error: null,
    })
    .eq("id", inviteId);
  if (updateError) throw new Error(updateError.message);

  const delivery = await deliverInvite({
    admin,
    table,
    inviteId,
    token: invite.token,
    kind: scopeType,
    email: invite.email,
    expiresAt,
    scopeName: await scopeName(admin, scopeType, scopeId),
  });
  await audit(admin, {
    scopeType,
    scopeId,
    action: "invite_resent",
    actorUserId,
    subjectInviteId: inviteId,
    nextRole: invite.role,
    metadata: { delivery_status: delivery.status },
  });
  return { ok: true, invite_id: inviteId, expires_at: expiresAt, delivery };
}

async function revokeInvite(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  scopeType: ScopeType,
  scopeId: string,
  actorUserId: string,
  actorRole: EffectiveRole,
) {
  const inviteId = requiredUuid(body.invite_id, "invite_id");
  const table = inviteTable(scopeType);
  const scopeColumn = inviteScopeColumn(scopeType);
  const { data: invite, error: readError } = await admin
    .from(table)
    .select("id, role, accepted_at")
    .eq("id", inviteId)
    .eq(scopeColumn, scopeId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!invite || invite.accepted_at) {
    throw new HttpError("Convite pendente não encontrado.", 404);
  }
  assertCanGrantRole(actorRole, normalizeRole(invite.role, scopeType));

  const { data, error } = await admin
    .from(table)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq(scopeColumn, scopeId)
    .is("accepted_at", null)
    .select("id, role")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError("Convite pendente não encontrado.", 404);

  await audit(admin, {
    scopeType,
    scopeId,
    action: "invite_revoked",
    actorUserId,
    subjectInviteId: inviteId,
    previousRole: data.role,
  });
  return { ok: true, invite_id: inviteId };
}

async function updateMemberRole(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  scopeType: ScopeType,
  scopeId: string,
  actorUserId: string,
  actorRole: EffectiveRole,
) {
  const userId = requiredUuid(body.user_id, "user_id");
  const nextRole = normalizeRole(body.role, scopeType);
  assertCanGrantRole(actorRole, nextRole);
  const member = await directMember(admin, scopeType, scopeId, userId);
  if (!member) {
    throw new HttpError(
      scopeType === "workspace"
        ? "Acesso herdado da organização não pode ser alterado dentro do cliente."
        : "Membro não encontrado.",
      409,
    );
  }
  if (actorRole !== "owner" && member.role === "owner") {
    throw new HttpError("Admin não pode alterar um Owner.", 403);
  }

  const { error } = await admin.rpc("manage_scope_member", {
    p_scope_type: scopeType,
    p_scope_id: scopeId,
    p_user_id: userId,
    p_action: "update",
    p_actor_user_id: actorUserId,
    p_role: nextRole,
  });
  if (error) throw membershipMutationError(error.message);
  return { ok: true, user_id: userId, role: nextRole };
}

async function removeMember(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  scopeType: ScopeType,
  scopeId: string,
  actorUserId: string,
  actorRole: EffectiveRole,
) {
  const userId = requiredUuid(body.user_id, "user_id");
  const member = await directMember(admin, scopeType, scopeId, userId);
  if (!member) {
    throw new HttpError(
      scopeType === "workspace"
        ? "Acesso herdado da organização não pode ser removido dentro do cliente."
        : "Membro não encontrado.",
      409,
    );
  }
  if (actorRole !== "owner" && member.role === "owner") {
    throw new HttpError("Admin não pode remover um Owner.", 403);
  }

  const { error } = await admin.rpc("manage_scope_member", {
    p_scope_type: scopeType,
    p_scope_id: scopeId,
    p_user_id: userId,
    p_action: "remove",
    p_actor_user_id: actorUserId,
    p_role: null,
  });
  if (error) throw membershipMutationError(error.message);
  return { ok: true, user_id: userId };
}

async function deliverInvite({
  admin,
  table,
  inviteId,
  token,
  kind,
  email,
  expiresAt,
  scopeName,
}: {
  admin: SupabaseClientAny;
  table: string;
  inviteId: string;
  token: string;
  kind: ScopeType;
  email: string;
  expiresAt: string;
  scopeName: string;
}) {
  let status: "sent" | "failed" = "failed";
  let deliveryError: string | null = null;

  try {
    if (!RESEND_API_KEY || !APP_PUBLIC_URL) {
      throw new Error("Entrega de email ainda não configurada.");
    }
    const inviteKind = kind === "organization" ? "organization" : "workspace";
    const inviteUrl =
      `${APP_PUBLIC_URL}/accept-invite?kind=${inviteKind}` +
      `&token=${encodeURIComponent(token)}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `invite/${inviteId}/${expiresAt}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [email],
        subject: `Convite para ${scopeName} no Infinite Profit`,
        html: inviteEmailHtml(scopeName, inviteUrl, expiresAt),
      }),
    });
    if (!response.ok) throw new Error(`Provedor de email respondeu HTTP ${response.status}.`);
    status = "sent";
  } catch (error) {
    deliveryError = sanitizeOperationalError(
      error instanceof Error ? error.message : "Falha ao enviar convite.",
    );
  }

  const { data: current } = await admin
    .from(table)
    .select("send_count")
    .eq("id", inviteId)
    .single();
  const { error: updateError } = await admin
    .from(table)
    .update({
      delivery_status: status,
      delivery_error: deliveryError,
      last_sent_at: status === "sent" ? new Date().toISOString() : null,
      send_count: Number(current?.send_count ?? 0) + 1,
    })
    .eq("id", inviteId);
  if (updateError) throw new Error(updateError.message);

  return { status, error: deliveryError };
}

async function resolveEffectiveAccess(
  admin: SupabaseClientAny,
  scopeType: ScopeType,
  scopeId: string,
  userId: string,
) {
  if (scopeType === "organization") {
    const { data } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", scopeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) throw new HttpError("Sem acesso à organização.", 403);
    return { role: data.role as EffectiveRole, origin: "organization" as const };
  }

  const [{ data: workspace }, { data: direct }] = await Promise.all([
    admin.from("workspaces").select("organization_id").eq("id", scopeId).maybeSingle(),
    admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", scopeId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!workspace) throw new HttpError("Cliente não encontrado.", 404);
  const { data: inherited } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  const access = highestEffectiveAccess([
    direct ? { role: direct.role as EffectiveRole, origin: "workspace" as const } : null,
    inherited ? { role: inherited.role as EffectiveRole, origin: "organization" as const } : null,
  ]);
  if (!access) throw new HttpError("Sem acesso ao cliente.", 403);
  return access;
}

async function directMember(
  admin: SupabaseClientAny,
  scopeType: ScopeType,
  scopeId: string,
  userId: string,
) {
  const { data, error } = await admin
    .from(memberTable(scopeType))
    .select("role")
    .eq(memberScopeColumn(scopeType), scopeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { role: EffectiveRole } | null;
}

async function scopeName(
  admin: SupabaseClientAny,
  scopeType: ScopeType,
  scopeId: string,
) {
  const { data } = await admin
    .from(scopeType === "organization" ? "organizations" : "workspaces")
    .select("name")
    .eq("id", scopeId)
    .maybeSingle();
  return String(data?.name ?? (scopeType === "organization" ? "sua organização" : "seu cliente"));
}

async function audit(
  admin: SupabaseClientAny,
  event: {
    scopeType: ScopeType;
    scopeId: string;
    action: string;
    actorUserId: string;
    subjectUserId?: string;
    subjectInviteId?: string;
    previousRole?: string;
    nextRole?: string;
    metadata?: Record<string, string>;
  },
) {
  const { error } = await admin.from("access_audit_events").insert({
    scope_type: event.scopeType,
    scope_id: event.scopeId,
    action: event.action,
    actor_user_id: event.actorUserId,
    subject_user_id: event.subjectUserId ?? null,
    subject_invite_id: event.subjectInviteId ?? null,
    previous_role: event.previousRole ?? null,
    next_role: event.nextRole ?? null,
    metadata: event.metadata ?? {},
  });
  if (error) throw new Error(error.message);
}

function inviteEmailHtml(scopeName: string, inviteUrl: string, expiresAt: string) {
  const safeScope = escapeHtml(scopeName);
  const safeUrl = escapeHtml(inviteUrl);
  const expiration = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(expiresAt));
  return `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <p style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#6d5bd0">INFINITE PROFIT</p>
      <h1 style="font-size:24px">Você foi convidado para ${safeScope}</h1>
      <p style="line-height:1.6;color:#566074">Use o botão abaixo para revisar e aceitar o acesso. Este convite expira em ${expiration}.</p>
      <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#6d5bd0;color:white;text-decoration:none;font-weight:700">Revisar convite</a></p>
      <p style="font-size:12px;color:#7b8495">Se você não esperava este convite, ignore esta mensagem.</p>
    </div>
  </body></html>`;
}

function normalizeScopeType(value: unknown): ScopeType {
  if (value === "organization") return "organization";
  if (value === "workspace" || value === "client") return "workspace";
  throw new HttpError("scope_type inválido.", 400);
}

function normalizeAction(value: unknown): TeamAction {
  const actions = new Set<TeamAction>([
    "create_invite",
    "resend_invite",
    "revoke_invite",
    "update_member_role",
    "remove_member",
  ]);
  if (!actions.has(value as TeamAction)) throw new HttpError("action inválida.", 400);
  return value as TeamAction;
}

function normalizeRole(value: unknown, scopeType: ScopeType): EffectiveRole {
  const role = String(value ?? "").trim() as EffectiveRole;
  const allowed = scopeType === "organization"
    ? new Set<EffectiveRole>(["owner", "admin"])
    : new Set<EffectiveRole>(["owner", "admin", "moderator", "member"]);
  if (!allowed.has(role)) throw new HttpError("Papel inválido para este escopo.", 400);
  return role;
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError("Informe um email válido.", 400);
  }
  return email;
}

function assertManager(role: EffectiveRole) {
  if (role !== "owner" && role !== "admin") {
    throw new HttpError("Sem permissão para administrar acessos.", 403);
  }
}

function assertCanGrantRole(actorRole: EffectiveRole, targetRole: EffectiveRole) {
  if (!canGrantRole(actorRole, targetRole)) {
    throw new HttpError("Somente um Owner pode conceder o papel Owner.", 403);
  }
}

function inviteTable(scopeType: ScopeType) {
  return scopeType === "organization" ? "organization_invites" : "workspace_invites";
}

function inviteScopeColumn(scopeType: ScopeType) {
  return scopeType === "organization" ? "organization_id" : "workspace_id";
}

function memberTable(scopeType: ScopeType) {
  return scopeType === "organization" ? "organization_members" : "workspace_members";
}

function memberScopeColumn(scopeType: ScopeType) {
  return scopeType === "organization" ? "organization_id" : "workspace_id";
}

function requiredUuid(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new HttpError(`${field} inválido.`, 400);
  }
  return normalized;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeOperationalError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[?&](token|secret|key|code)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]")
    .slice(0, 500);
}

function membershipMutationError(message: string) {
  if (message.includes("last Owner")) {
    return new HttpError("O último Owner não pode ser removido ou rebaixado.", 409);
  }
  if (message.includes("Direct member not found")) {
    return new HttpError("Membro direto não encontrado.", 404);
  }
  return new Error(message);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

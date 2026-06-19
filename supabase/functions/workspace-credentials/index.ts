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
const GATEWAY_PROVIDERS = new Set(["hotmart", "hubla", "kiwify"]);
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const caller = await resolveUser(authHeader);
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const workspaceId = stringOrNull(body.workspace_id);
    if (!workspaceId) {
      return json({ error: "workspace_id obrigatorio" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    await assertWorkspaceAdmin(admin, workspaceId, caller.userId);

    if (body.action === "upsert_workspace_integration") {
      const result = await upsertWorkspaceIntegration(admin, body, workspaceId, caller.userId);
      return json({ ok: true, integration: result });
    }

    if (body.action === "upsert_meta_account") {
      const result = await upsertMetaAccount(admin, body, workspaceId, caller.userId);
      return json({ ok: true, meta_account: result });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("workspace-credentials error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function upsertWorkspaceIntegration(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  workspaceId: string,
  userId: string,
) {
  const gatewayToken = stringOrNull(body.gateway_webhook_token);
  if (gatewayToken && gatewayToken.length > 160) {
    throw new Error("gateway_webhook_token invalido");
  }

  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    created_by: userId,
  };
  if (Object.hasOwn(body, "gateway_provider")) {
    payload.gateway_provider = normalizeGatewayProvider(body.gateway_provider);
  }
  if (gatewayToken) payload.gateway_webhook_token = gatewayToken;

  const vturbApiKey = stringOrNull(body.vturb_api_key);
  const gatewaySecret = stringOrNull(body.gateway_webhook_secret);
  if (vturbApiKey) {
    if (vturbApiKey.length > 1000) throw new Error("VTurb API key muito longa");
    payload.vturb_api_key = vturbApiKey;
  }
  if (gatewaySecret) {
    if (gatewaySecret.length > 1000) throw new Error("Gateway secret muito longo");
    payload.gateway_webhook_secret = gatewaySecret;
  }

  const { data, error } = await admin
    .from("workspace_integrations")
    .upsert(payload, { onConflict: "workspace_id" })
    .select("workspace_id, gateway_provider, gateway_webhook_token")
    .single();
  if (error) throw new Error(error.message);

  return data;
}

async function upsertMetaAccount(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  workspaceId: string,
  userId: string,
) {
  const metaAccountId = stringOrNull(body.meta_account_id);
  const accountId = normalizeMetaAccountId(body.account_id);
  const label = stringOrNull(body.label);
  const nextToken = stringOrNull(body.access_token);

  if (!accountId) throw new Error("account_id obrigatorio");
  if (accountId.length > 80) throw new Error("account_id invalido");
  if (nextToken && nextToken.length > 2000) throw new Error("access_token muito longo");

  let existing: { id: string; workspace_id: string; account_id: string; access_token: string } | null = null;
  if (metaAccountId) {
    const { data, error } = await admin
      .from("workspace_meta_accounts")
      .select("id, workspace_id, account_id, access_token")
      .eq("id", metaAccountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.workspace_id !== workspaceId) {
      throw new Error("Conta Meta nao encontrada neste workspace");
    }
    existing = data as { id: string; workspace_id: string; account_id: string; access_token: string };
  }

  if (!nextToken && !existing) {
    throw new Error("access_token obrigatorio para nova conta Meta");
  }
  if (!nextToken && existing?.account_id !== accountId) {
    throw new Error("access_token obrigatorio ao trocar o Ad Account ID");
  }
  const accessToken = nextToken ?? existing?.access_token;
  if (!accessToken) {
    throw new Error("access_token obrigatorio");
  }

  const accountPayload = {
    account_id: accountId,
    access_token: accessToken,
    label,
  };

  if (existing) {
    const { data, error } = await admin
      .from("workspace_meta_accounts")
      .update(accountPayload)
      .eq("id", existing.id)
      .select("id, account_id, label")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await admin
    .from("workspace_meta_accounts")
    .upsert({
      ...accountPayload,
      workspace_id: workspaceId,
      created_by: userId,
    }, { onConflict: "workspace_id,account_id" })
    .select("id, account_id, label")
    .single();
  if (error) throw new Error(error.message);

  return data;
}

async function resolveUser(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user?.id) return null;
  return { userId: data.user.id };
}

async function assertWorkspaceAdmin(admin: SupabaseClientAny, workspaceId: string, userId: string) {
  const { data: workspaceMembership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (workspaceMembership?.role === "owner" || workspaceMembership?.role === "admin") {
    return;
  }

  const { data: workspace } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  const { data: orgMembership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace?.organization_id ?? "")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") {
    return;
  }

  throw new Error("Sem permissao para alterar credenciais deste workspace");
}

function normalizeGatewayProvider(value: unknown) {
  const provider = stringOrNull(value);
  if (!provider) return null;
  if (!GATEWAY_PROVIDERS.has(provider)) {
    throw new Error("gateway_provider invalido");
  }
  return provider;
}

function normalizeMetaAccountId(value: unknown) {
  const accountId = stringOrNull(value);
  if (!accountId) return null;
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
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

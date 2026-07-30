/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  authorizeHotmartClientCredentials,
  HotmartApiError,
  hotmartAccessToken,
  hotmartApiJson,
  storeHotmartCredential,
} from "../_shared/hotmart.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_PRODUCTS_URL =
  "https://developers.hotmart.com/products/api/v1/products?max_results=1";

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

Deno.serve(async (req) => {
  let action = "";
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const caller = await resolveUser(req.headers.get("Authorization"));
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    action = String(body.action ?? "");
    const workspaceId = stringOrNull(body.workspace_id);
    if (!workspaceId) {
      return json({ error: "workspace_id obrigatorio" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    await assertWorkspaceAdmin(admin, workspaceId, caller.userId);

    if (action === "connect") {
      const clientId = requiredBodyValue(body.client_id, "client_id");
      const clientSecret = requiredBodyValue(
        body.client_secret,
        "client_secret",
      );
      const basicToken = requiredBodyValue(body.basic_token, "token Basic");
      const credential = await authorizeHotmartClientCredentials({
        clientId,
        clientSecret,
        basicToken,
      });
      const integrationId = await ensureIntegration(admin, {
        integrationId: stringOrNull(body.integration_id),
        workspaceId,
        userId: caller.userId,
        label: stringOrNull(body.label) ?? "Hotmart",
      });
      await storeHotmartCredential(admin, integrationId, credential);

      const now = new Date().toISOString();
      const { error } = await admin
        .from("workspace_checkout_integrations")
        .update({
          status: "connected",
          auth_mode: "client_credentials",
          credential_expires_at: credential.expires_at,
          validated_at: now,
          last_error_code: null,
          last_error_message: null,
        })
        .eq("id", integrationId);
      if (error) throw new Error(error.message);

      return json({
        ok: true,
        integration_id: integrationId,
        validated_at: now,
      });
    }

    const integrationId = stringOrNull(body.integration_id);
    if (!integrationId) {
      return json({ error: "integration_id obrigatorio" }, 400);
    }
    await assertIntegration(admin, integrationId, workspaceId);

    if (action === "validate") {
      const token = await hotmartAccessToken(admin, integrationId);
      await hotmartApiJson(
        Deno.env.get("HOTMART_PRODUCTS_URL") || DEFAULT_PRODUCTS_URL,
        token,
      );
      const now = new Date().toISOString();
      const { error } = await admin
        .from("workspace_checkout_integrations")
        .update({
          status: "connected",
          validated_at: now,
          last_error_code: null,
          last_error_message: null,
        })
        .eq("id", integrationId);
      if (error) throw new Error(error.message);
      return json({ ok: true, validated_at: now });
    }

    if (action === "disconnect") {
      for (const kind of ["credential", "webhook"]) {
        const { error: secretError } = await admin.rpc(
          "delete_checkout_integration_secret",
          {
            _integration_id: integrationId,
            _kind: kind,
          },
        );
        if (secretError) throw new Error(secretError.message);
      }
      const { error } = await admin
        .from("workspace_checkout_integrations")
        .update({
          status: "disconnected",
          credential_expires_at: null,
          validated_at: null,
          last_error_code: null,
          last_error_message: null,
        })
        .eq("id", integrationId);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    const status = error instanceof HttpError
      ? error.status
      : Number((error as { status?: number })?.status) || 500;
    const isInvalidConnectionCredential =
      action === "connect"
      && error instanceof HotmartApiError
      && [400, 401, 403].includes(status);
    const code = error instanceof HttpError
      ? error.code
      : isInvalidConnectionCredential
        ? "HOTMART_INVALID_CREDENTIALS"
        : status === 401
          ? "HOTMART_REAUTH_REQUIRED"
          : "HOTMART_AUTH_FAILED";
    console.error(JSON.stringify({
      event: "hotmart_auth_failed",
      status,
      code,
      error: error instanceof Error ? error.message : "Erro inesperado",
    }));
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro inesperado",
      code,
    }, status);
  }
});

async function assertIntegration(
  admin: SupabaseClientAny,
  integrationId: string,
  workspaceId: string,
) {
  const { data, error } = await admin
    .from("workspace_checkout_integrations")
    .select("id")
    .eq("id", integrationId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "hotmart")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new HttpError(
      "Integração Hotmart não encontrada.",
      404,
      "NOT_FOUND",
    );
  }
}

async function ensureIntegration(
  admin: SupabaseClientAny,
  args: {
    integrationId: string | null;
    workspaceId: string;
    userId: string;
    label: string;
  },
) {
  if (args.integrationId) {
    await assertIntegration(admin, args.integrationId, args.workspaceId);
    return args.integrationId;
  }

  const { data, error } = await admin
    .from("workspace_checkout_integrations")
    .insert({
      workspace_id: args.workspaceId,
      provider: "hotmart",
      label: args.label.slice(0, 120),
      status: "pending",
      auth_mode: "client_credentials",
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Falha ao criar integração Hotmart");
  }
  return data.id as string;
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

async function assertWorkspaceAdmin(
  admin: SupabaseClientAny,
  workspaceId: string,
  userId: string,
) {
  const { data: workspaceMember } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workspaceMember?.role === "owner" || workspaceMember?.role === "admin") {
    return;
  }

  const { data: workspace } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const { data: orgMember } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace?.organization_id ?? "")
    .eq("user_id", userId)
    .maybeSingle();
  if (orgMember?.role === "owner" || orgMember?.role === "admin") return;
  throw new HttpError(
    "Sem permissão para conectar a Hotmart.",
    403,
    "FORBIDDEN",
  );
}

function requiredBodyValue(value: unknown, label: string) {
  const normalized = stringOrNull(value);
  if (!normalized) {
    throw new HttpError(
      `${label} obrigatorio`,
      400,
      "INVALID_CREDENTIAL",
    );
  }
  if (normalized.length > 2000) {
    throw new HttpError(`${label} invalido`, 400, "INVALID_CREDENTIAL");
  }
  return normalized;
}

function stringOrNull(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

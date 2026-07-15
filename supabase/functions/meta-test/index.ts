/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

/**
 * Tests Meta access.
 * Body, discovery mode: { action: "list_accounts", workspace_id: uuid, access_token: string }
 * Body, unsaved setup mode: { account_id: string, access_token: string }
 * Body, stored account mode: { meta_account_id: uuid }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const directAccountId = stringOrNull(body.account_id);
    const directToken = stringOrNull(body.access_token);
    const metaAccountId = stringOrNull(body.meta_account_id);
    const action = stringOrNull(body.action);

    if (action === "list_accounts") {
      const workspaceId = stringOrNull(body.workspace_id);
      if (!workspaceId || !directToken) {
        return json({ ok: false, error: "workspace_id e access_token sao obrigatorios" }, 400);
      }

      const caller = await resolveUser(req.headers.get("Authorization"));
      if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);

      const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false },
      });
      await assertWorkspaceAdmin(sb, workspaceId, caller.userId);

      try {
        const accounts = await listAccessibleAdAccounts(directToken);
        return json({ ok: true, accounts });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao buscar contas Meta";
        console.warn("[meta-test] Meta account discovery failed", {
          workspaceId,
          message,
        });
        // Graph validation errors are an expected response to the discovery form.
        // Keep HTTP 200 so the client receives the useful Meta error instead of a generic FunctionsHttpError.
        return json({ ok: false, error: message, code: "META_DISCOVERY_FAILED" });
      }
    }

    let accountId = directAccountId;
    let token = directToken;

    if (metaAccountId) {
      const authHeader = req.headers.get("Authorization");
      const caller = await resolveUser(authHeader);
      if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);

      const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false },
      });
      const { data: account, error } = await sb
        .from("workspace_meta_accounts")
        .select("workspace_id, account_id, access_token")
        .eq("id", metaAccountId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!account?.workspace_id || !account.access_token) {
        return json({ ok: false, error: "Conta Meta nao encontrada" }, 404);
      }

      await assertWorkspaceAdmin(sb, account.workspace_id, caller.userId);
      accountId = account.account_id;
      token = account.access_token;
    }

    if (!accountId || !token) {
      return json({ ok: false, error: "account_id/access_token ou meta_account_id sao obrigatorios" }, 400);
    }

    const normalizedAccountId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const url = `https://graph.facebook.com/v21.0/${normalizedAccountId}?fields=name,account_status,currency,timezone_name`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await response.json().catch(() => ({}));

    if (!response.ok || data.error) {
      const msg = data?.error?.message ?? `HTTP ${response.status}`;
      return json({ ok: false, error: msg, code: data?.error?.code });
    }

    return json({
      ok: true,
      name: data.name ?? null,
      account_status: data.account_status ?? null,
      currency: data.currency ?? null,
      timezone: data.timezone_name ?? null,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function listAccessibleAdAccounts(token: string) {
  const accounts = new Map<string, Record<string, unknown>>();
  const baseUrl =
    "https://graph.facebook.com/v21.0/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name&limit=200";
  let after: string | null = null;
  let hasNextPage = true;

  for (let page = 0; hasNextPage && page < 10; page += 1) {
    const url = new URL(baseUrl);
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(message);
    }

    const rows = Array.isArray(payload.data) ? payload.data : [];
    for (const row of rows) {
      const rawId = stringOrNull(row?.account_id) ?? stringOrNull(row?.id);
      if (!rawId) continue;
      const accountId = rawId.startsWith("act_") ? rawId : `act_${rawId}`;
      accounts.set(accountId, {
        id: accountId,
        account_id: accountId,
        name: stringOrNull(row?.name),
        account_status: typeof row?.account_status === "number" ? row.account_status : null,
        currency: stringOrNull(row?.currency),
        timezone: stringOrNull(row?.timezone_name),
      });
    }

    after = stringOrNull(payload?.paging?.cursors?.after);
    hasNextPage = Boolean(payload?.paging?.next && after);
  }

  return [...accounts.values()].sort((left, right) =>
    String(left.name ?? left.account_id).localeCompare(String(right.name ?? right.account_id), "pt-BR")
  );
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
  sb: SupabaseClientAny,
  workspaceId: string,
  userId: string,
) {
  const { data: workspaceMembership } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (workspaceMembership?.role === "owner" || workspaceMembership?.role === "admin") {
    return;
  }

  const { data: workspace } = await sb
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  const { data: orgMembership } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace?.organization_id ?? "")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") {
    return;
  }

  throw new Error("Sem permissao para testar esta conta Meta");
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

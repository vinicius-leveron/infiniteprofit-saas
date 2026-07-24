/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  listAccessibleMetaAdAccounts,
  MetaCredentialError,
  missingMetaAccountIds,
  normalizeMetaAccountId,
  validateMetaInsightsAccess,
} from "../_shared/meta-credentials.ts";
import {
  enqueueSyncJobBatch,
  type EnqueueSyncJobResult,
} from "../_shared/sync-jobs.ts";
import { localDateWindow } from "../sync-jobs/core.ts";

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

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

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
      const result = await upsertMetaAccount(
        admin,
        body,
        workspaceId,
        caller.userId,
      );
      return json({
        ok: true,
        meta_account: result.account,
        sync: result.sync,
      });
    }

    if (body.action === "replace_meta_credential") {
      const result = await replaceMetaCredential(
        admin,
        body,
        workspaceId,
        caller.userId,
      );
      return json({
        ok: true,
        credential: result,
      });
    }

    if (body.action === "delete_meta_account") {
      const result = await deleteMetaAccount(admin, body, workspaceId);
      return json({ ok: true, deleted_meta_account_id: result });
    }

    if (body.action === "upsert_checkout_binding") {
      const result = await upsertCheckoutBinding(admin, body, workspaceId);
      return json({ ok: true, checkout_binding: result });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    if (error instanceof MetaCredentialError) {
      console.warn(JSON.stringify({
        event: "meta_credential_rejected",
        code: error.code,
        provider_code: error.providerCode,
        provider_subcode: error.providerSubcode,
      }));
      return json({
        ok: false,
        error: error.message,
        code: error.code,
      }, 422);
    }

    const status = error instanceof HttpError
      ? error.status
      : 500;
    console.error(JSON.stringify({
      event: "workspace_credentials_failed",
      status,
      error: error instanceof Error ? error.message : "Erro inesperado",
    }));
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro inesperado",
      ...(error instanceof HttpError && error.code
        ? { code: error.code }
        : {}),
      ...(error instanceof HttpError && error.details
        ? { details: error.details }
        : {}),
    }, status);
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
    payload.vturb_sync_suspended_at = null;
    payload.vturb_sync_suspension_reason = null;
    payload.vturb_validated_at = null;
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
  if (nextToken) {
    await validateMetaInsightsAccess(accountId, nextToken);
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
    if (nextToken) {
      await refreshWorkspaceMetaCredentialState(
        admin,
        workspaceId,
        userId,
      );
    }
    return {
      account: data,
      sync: nextToken
        ? await enqueueMetaCredentialRefresh(admin, workspaceId, data)
        : null,
    };
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
  if (nextToken) {
    await refreshWorkspaceMetaCredentialState(
      admin,
      workspaceId,
      userId,
    );
  }

  return {
    account: data,
    sync: nextToken
      ? await enqueueMetaCredentialRefresh(admin, workspaceId, data)
      : null,
  };
}

async function refreshWorkspaceMetaCredentialState(
  admin: SupabaseClientAny,
  workspaceId: string,
  userId: string,
) {
  const { error } = await admin.rpc(
    "refresh_workspace_meta_credential_state",
    {
      _workspace_id: workspaceId,
      _actor_id: userId,
    },
  );
  if (error) throw new Error(error.message);
}

async function replaceMetaCredential(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  workspaceId: string,
  userId: string,
) {
  const accessToken = stringOrNull(body.access_token);
  if (!accessToken) {
    throw new HttpError("Informe o novo token Meta.", 400, "meta_token_required");
  }
  if (accessToken.length > 2000) {
    throw new HttpError("Token Meta inválido.", 400, "meta_token_invalid");
  }

  const { data: configuredRows, error: configuredError } = await admin
    .from("workspace_meta_accounts")
    .select("id, account_id, label")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (configuredError) throw new Error(configuredError.message);

  const configuredAccounts = (configuredRows ?? []) as Array<{
    id: string;
    account_id: string;
    label: string | null;
  }>;
  if (configuredAccounts.length === 0) {
    throw new HttpError(
      "Este cliente ainda não possui contas Meta cadastradas.",
      409,
      "meta_accounts_missing",
    );
  }

  const accessibleAccounts = await listAccessibleMetaAdAccounts(accessToken);
  const missingAccountIds = missingMetaAccountIds(
    configuredAccounts.map((account) => account.account_id),
    accessibleAccounts.map((account) => account.account_id),
  );
  if (missingAccountIds.length > 0) {
    const labelsById = new Map(
      configuredAccounts.map((account) => [
        normalizeMetaAccountId(account.account_id),
        account.label,
      ]),
    );
    const missingAccounts = missingAccountIds.map((accountId) => ({
      account_id: accountId,
      label: labelsById.get(accountId) ?? null,
    }));
    throw new HttpError(
      `O token não possui acesso a ${missingAccountIds.length} ${
        missingAccountIds.length === 1 ? "conta vinculada" : "contas vinculadas"
      }. Revise os ativos no Meta Business antes de continuar.`,
      422,
      "meta_account_access_missing",
      { missing_accounts: missingAccounts },
    );
  }

  await Promise.all(
    configuredAccounts.map((account) =>
      validateMetaInsightsAccess(account.account_id, accessToken)
    ),
  );

  const validatedAt = new Date().toISOString();
  const { data: updatedAccounts, error: replaceError } = await admin.rpc(
    "replace_workspace_meta_credential",
    {
      _workspace_id: workspaceId,
      _access_token: accessToken,
      _validated_at: validatedAt,
      _actor_id: userId,
    },
  );
  if (replaceError) throw new Error(replaceError.message);

  const refreshes = [];
  for (const account of configuredAccounts) {
    refreshes.push(
      await enqueueMetaCredentialRefresh(admin, workspaceId, account),
    );
  }

  const jobs = refreshes.flatMap((refresh) => refresh.jobs);
  return {
    accounts_updated: Number(updatedAccounts ?? configuredAccounts.length),
    accounts_validated: configuredAccounts.length,
    validated_at: validatedAt,
    sync: {
      queued: jobs.some((job) =>
        job.status === "inserted" || job.status === "updated"
      ),
      jobs_total: jobs.length,
      jobs_started: jobs.filter((job) =>
        job.status === "inserted" || job.status === "updated"
      ).length,
    },
  };
}

async function enqueueMetaCredentialRefresh(
  admin: SupabaseClientAny,
  workspaceId: string,
  account: { id: string; account_id: string },
) {
  try {
    const { data: bindings, error } = await admin
      .from("project_meta_accounts")
      .select("project_id")
      .eq("meta_account_id", account.id);
    if (error) throw new Error(error.message);

    const projectIds = [
      ...new Set(
        (bindings ?? [])
          .map((binding: { project_id?: string | null }) =>
            binding.project_id ?? ""
          )
          .filter(Boolean),
      ),
    ];
    if (projectIds.length === 0) {
      return {
        queued: false,
        reason: "no_bound_funnels",
        jobs: [] as EnqueueSyncJobResult[],
      };
    }

    const recentWindow = localDateWindow(3);
    const refreshWindow = localDateWindow(30);
    const jobs = await enqueueSyncJobBatch(
      admin,
      projectIds.flatMap((projectId) => [
        {
          job: {
            workspaceId,
            projectId,
            source: "meta" as const,
            entityType: "meta_account" as const,
            entityId: `${account.account_id}:fast`,
            dateStart: recentWindow.dateStart,
            dateEnd: recentWindow.dateEnd,
            priority: 0,
            maxAttempts: 5,
            payload: {
              workspace_meta_account_id: account.id,
              account_id: account.account_id,
              reason: "credential_updated",
              sync_profile: "fast",
              levels: ["account"],
            },
          },
          options: {
            requeueSucceededAfterMinutes: 0,
            reviveDeadLetter: true,
          },
        },
        {
          job: {
            workspaceId,
            projectId,
            source: "meta" as const,
            entityType: "meta_account" as const,
            entityId: account.account_id,
            dateStart: recentWindow.dateStart,
            dateEnd: recentWindow.dateEnd,
            priority: 1,
            maxAttempts: 5,
            payload: {
              workspace_meta_account_id: account.id,
              account_id: account.account_id,
              reason: "credential_updated",
              sync_profile: "detail",
              levels: ["campaign", "adset", "ad"],
            },
          },
          options: {
            requeueSucceededAfterMinutes: 0,
            reviveDeadLetter: true,
          },
        },
        {
          job: {
            workspaceId,
            projectId,
            source: "meta" as const,
            entityType: "meta_account" as const,
            entityId: `${account.account_id}:credential-refresh`,
            dateStart: refreshWindow.dateStart,
            dateEnd: refreshWindow.dateEnd,
            priority: 2,
            maxAttempts: 5,
            payload: {
              workspace_meta_account_id: account.id,
              account_id: account.account_id,
              reason: "credential_updated",
              sync_profile: "credential_backfill",
              levels: ["account", "campaign", "adset", "ad"],
            },
          },
          options: {
            requeueSucceededAfterMinutes: 0,
            reviveDeadLetter: true,
          },
        },
      ]),
    );

    return {
      queued: jobs.some((job) =>
        job.status === "inserted" || job.status === "updated"
      ),
      reason: null,
      jobs,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Falha ao enfileirar sincronização";
    console.error(JSON.stringify({
      event: "meta_credential_refresh_enqueue_failed",
      workspace_id: workspaceId,
      meta_account_id: account.id,
      error: message,
    }));
    return {
      queued: false,
      reason: "enqueue_failed",
      jobs: [] as EnqueueSyncJobResult[],
    };
  }
}

async function deleteMetaAccount(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  workspaceId: string,
) {
  const metaAccountId = stringOrNull(body.meta_account_id);
  if (!metaAccountId) {
    throw new HttpError("meta_account_id obrigatorio", 400);
  }

  const { data, error } = await admin.rpc("delete_workspace_meta_account", {
    _workspace_id: workspaceId,
    _meta_account_id: metaAccountId,
  });
  if (error?.code === "23503") {
    throw new HttpError(
      "Desvincule esta conta Meta dos funis antes de removê-la.",
      409,
    );
  }
  if (error?.code === "P0002") {
    throw new HttpError("Conta Meta não encontrada neste cliente.", 404);
  }
  if (error) throw new Error(error.message);

  return data as string;
}

async function upsertCheckoutBinding(
  admin: SupabaseClientAny,
  body: Record<string, unknown>,
  workspaceId: string,
) {
  const projectId = stringOrNull(body.project_id);
  if (!projectId) {
    throw new HttpError("project_id obrigatorio", 400);
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) {
    throw new HttpError("Funil não encontrado neste cliente.", 404);
  }

  const { data, error } = await admin
    .from("project_checkout_bindings")
    .upsert(
      {
        project_id: projectId,
        enabled: body.enabled !== false,
      },
      { onConflict: "project_id" },
    )
    .select("project_id, webhook_token, enabled")
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

  throw new HttpError(
    "Sem permissao para alterar credenciais deste workspace",
    403,
  );
}

function normalizeGatewayProvider(value: unknown) {
  const provider = stringOrNull(value);
  if (!provider) return null;
  if (!GATEWAY_PROVIDERS.has(provider)) {
    throw new Error("gateway_provider invalido");
  }
  return provider;
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

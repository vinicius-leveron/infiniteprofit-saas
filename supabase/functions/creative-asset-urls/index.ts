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
const CREATIVE_BUCKET = Deno.env.get("CREATIVE_BUCKET") || "creative-assets";
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 30;
const MAX_EXPIRES_IN_SECONDS = 60 * 60;
const MAX_ASSETS = 250;

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

interface CreativeAssetStorageRow {
  id: string;
  media_type: string | null;
  media_storage_path: string | null;
  poster_storage_path: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await resolveUser(req.headers.get("Authorization"));
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = stringOrNull(body.project_id);
    if (!projectId) return json({ error: "project_id obrigatorio" }, 400);

    const assetIds = normalizeAssetIds(body.asset_ids);
    if (assetIds.length === 0) return json({ error: "asset_ids obrigatorio" }, 400);
    const expiresIn = normalizeExpiresIn(body.expires_in);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const project = await loadProject(admin, projectId);
    await assertWorkspaceAccess(admin, project.workspace_id, caller.userId);
    const assets = await loadAssets(admin, projectId, assetIds);
    const signedAssets = await Promise.all(assets.map((asset) => signAsset(admin, asset, expiresIn)));

    return json({
      ok: true,
      expires_in: expiresIn,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      assets: signedAssets,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) {
      console.error("creative-asset-urls error", error);
    } else {
      console.warn("creative-asset-urls rejected request", error);
    }
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, status);
  }
});

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function loadProject(admin: SupabaseClientAny, projectId: string) {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.workspace_id) throw new HttpError(404, "Projeto nao encontrado");
  return data as { id: string; workspace_id: string };
}

async function loadAssets(admin: SupabaseClientAny, projectId: string, assetIds: string[]) {
  let query = admin
    .from("creative_assets")
    .select("id, media_type, media_storage_path, poster_storage_path")
    .eq("project_id", projectId)
    .limit(MAX_ASSETS);

  if (assetIds.length) query = query.in("id", assetIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CreativeAssetStorageRow[];
}

async function signAsset(admin: SupabaseClientAny, asset: CreativeAssetStorageRow, expiresIn: number) {
  const [mediaUrl, posterUrl] = await Promise.all([
    signPath(admin, asset.media_storage_path, expiresIn),
    signPath(admin, asset.poster_storage_path, expiresIn),
  ]);

  return {
    id: asset.id,
    media_type: asset.media_type,
    media_url: mediaUrl,
    poster_url: posterUrl,
  };
}

async function signPath(admin: SupabaseClientAny, storagePath: string | null, expiresIn: number) {
  if (!storagePath) return null;
  const { data, error } = await admin.storage
    .from(CREATIVE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) {
    console.warn("creative-asset-urls signing failed", storagePath, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
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

async function assertWorkspaceAccess(admin: SupabaseClientAny, workspaceId: string, userId: string) {
  const { data: workspaceMembership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (workspaceMembership?.role) return;

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

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") return;

  throw new HttpError(403, "Sem permissao para acessar criativos deste workspace");
}

function normalizeAssetIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => stringOrNull(item)).filter(Boolean) as string[])].slice(0, MAX_ASSETS);
}

function normalizeExpiresIn(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXPIRES_IN_SECONDS;
  return Math.min(Math.floor(parsed), MAX_EXPIRES_IN_SECONDS);
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

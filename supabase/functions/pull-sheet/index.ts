import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type DiagnosticStage =
  | "missing_url"
  | "invalid_url"
  | "fetch_failed"
  | "http_error"
  | "empty_response"
  | "html_response"
  | "forbidden_token"
  | "doget_missing"
  | "ok";

function classify(
  status: number,
  body: string,
): { stage: DiagnosticStage; message: string; hint?: string } {
  const head = body.slice(0, 400).toLowerCase();
  const trimmed = body.trim();

  if (!body || body.length < 2) {
    return {
      stage: "empty_response",
      message: "O Apps Script retornou uma resposta vazia.",
      hint: "Verifique se o doGet está retornando ContentService.createTextOutput(csv).",
    };
  }

  if (trimmed === "Forbidden" || trimmed.toLowerCase() === "forbidden") {
    return {
      stage: "forbidden_token",
      message: "Token do dialog não bate com o TOKEN do Apps Script.",
      hint: "Copie o token mostrado aqui e cole na constante TOKEN do código no Apps Script. Depois publique uma nova versão.",
    };
  }

  if (head.includes("script function not found") || head.includes("doget")) {
    return {
      stage: "doget_missing",
      message: "Apps Script não tem função doGet no nível raiz.",
      hint: "Apague tudo do editor e cole o código exatamente como mostrado, sem wrapper extra.",
    };
  }

  if (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("google accounts")
  ) {
    return {
      stage: "html_response",
      message: "Apps Script retornou HTML em vez de CSV.",
      hint: "No Apps Script, publique como App da Web com acesso de qualquer pessoa.",
    };
  }

  if (status >= 400) {
    return {
      stage: "http_error",
      message: `HTTP ${status} ao buscar a planilha.`,
      hint: "Cheque se a URL é a do App da Web, normalmente terminando em /exec.",
    };
  }

  return { stage: "ok", message: "OK" };
}

async function fetchSheetCsv(
  sheetUrl: string,
  token: string | null,
): Promise<{
  ok: boolean;
  csv?: string;
  diagnostic: {
    stage: DiagnosticStage;
    message: string;
    hint?: string;
    httpStatus?: number;
    finalUrl?: string;
    bodyPreview?: string;
  };
}> {
  let url: URL;
  try {
    url = new URL(sheetUrl);
  } catch {
    return {
      ok: false,
      diagnostic: {
        stage: "invalid_url",
        message: "URL inválida. Cole a URL completa do Web App.",
      },
    };
  }

  if (token) url.searchParams.set("token", token);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/csv, text/plain, */*" },
    });
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        stage: "fetch_failed",
        message: `Falha de rede ao chamar o Apps Script: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }

  const body = await response.text().catch(() => "");
  const classification = classify(response.status, body);
  if (classification.stage !== "ok") {
    return {
      ok: false,
      diagnostic: {
        ...classification,
        httpStatus: response.status,
        finalUrl: response.url,
        bodyPreview: body.slice(0, 200),
      },
    };
  }

  return {
    ok: true,
    csv: body,
    diagnostic: {
      stage: "ok",
      message: "OK",
      httpStatus: response.status,
      finalUrl: response.url,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Unauthorized" });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user?.id) {
      return json(401, { error: "Unauthorized" });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(400, { error: "Invalid JSON" });
    }

    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const validateOnly = body.validateOnly === true;
    if (!projectId) {
      return json(400, { error: "projectId is required" });
    }

    const { data: project, error: projectError } = await userClient
      .from("projects")
      .select("id, workspace_id, sheet_url, sync_token")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError || !project?.workspace_id) {
      return json(404, { error: "Project not found" });
    }

    const sheetUrl = validateOnly
      ? body.sheetUrlOverride?.trim() || project.sheet_url
      : project.sheet_url;
    const syncToken = validateOnly
      ? body.syncTokenOverride?.trim() || project.sync_token
      : project.sync_token;

    if (!sheetUrl) {
      return json(400, {
        ok: false,
        diagnostic: {
          stage: "missing_url",
          message: "Este projeto não tem URL de sincronização configurada.",
        },
      });
    }

    const result = await fetchSheetCsv(sheetUrl, syncToken);
    if (!result.ok) {
      return json(200, { ok: false, diagnostic: result.diagnostic });
    }

    const csv = result.csv!;
    if (validateOnly) {
      const lines = csv.split(/\r?\n/).slice(0, 5);
      return json(200, {
        ok: true,
        diagnostic: result.diagnostic,
        preview: {
          firstLines: lines,
          totalBytes: csv.length,
          lineCount: csv.split(/\r?\n/).length,
        },
      });
    }

    const runInsert = await userClient
      .from("sync_runs")
      .insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        source: "sheet",
        status: "running",
        initiated_by: userData.user.id,
        started_at: new Date().toISOString(),
        details: { mode: "manual" },
      })
      .select("id")
      .maybeSingle();
    const runId = runInsert.data?.id as string | undefined;

    const now = new Date().toISOString();
    const { error: updateError } = await userClient
      .from("projects")
      .update({
        csv_content: csv,
        last_synced_at: now,
        updated_at: now,
      })
      .eq("id", projectId);

    if (updateError) {
      if (runId) {
        await userClient
          .from("sync_runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_message: updateError.message,
          })
          .eq("id", runId);
      }
      return json(500, { error: `Erro ao salvar: ${updateError.message}` });
    }

    if (runId) {
      await userClient
        .from("sync_runs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          details: {
            mode: "manual",
            bytes: csv.length,
            line_count: csv.split(/\r?\n/).length,
          },
        })
        .eq("id", runId);
    }

    return json(200, {
      ok: true,
      success: true,
      last_synced_at: now,
      bytes: csv.length,
    });
  } catch (error) {
    console.error("pull-sheet error", error);
    return json(500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

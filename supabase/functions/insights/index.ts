// Edge function: gera insights automáticos sobre o dashboard.
// Suporta múltiplos provedores: Lovable AI (default), OpenAI, Anthropic, OpenRouter.
// Lê config do usuário via tabela ai_settings (RPC get_my_ai_settings_safe + service role para api_key).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface InsightPayload {
  totals: Record<string, number | null>;
  prevTotals?: Record<string, number | null> | null;
  topBumps?: Array<{ name: string; revenue: number; convRate: number | null }>;
  bestWeekday?: { dia: string; avgVendas: number } | null;
  worstWeekday?: { dia: string; avgVendas: number } | null;
  periodDays: number;
}

interface UserAiConfig {
  provider: "lovable" | "openai" | "anthropic" | "openrouter";
  api_key: string | null;
  model: string | null;
  skill_text: string | null;
}

const DEFAULT_MODELS: Record<UserAiConfig["provider"], string> = {
  lovable: "google/gemini-3-flash-preview",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  openrouter: "openai/gpt-4o-mini",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: InsightPayload = await req.json();

    // Resolve config do usuário (se autenticado)
    const userCfg = await loadUserConfig(req);
    const provider = userCfg.provider;
    const model = userCfg.model || DEFAULT_MODELS[provider];

    const baseSystem =
      `Você é um analista de marketing digital especializado em funis de venda online (VSL, bumps, upsells).
Recebe métricas agregadas de um dashboard e devolve insights curtos, diretos, acionáveis em PT-BR.
Use linguagem simples e direta. Foque no que importa: receita, ROI, lucro, gargalos do funil.
Sempre que possível, mencione número absoluto + variação percentual.
Retorne EXATAMENTE 3 insights, cada um com no máximo 22 palavras.`;

    const systemPrompt = userCfg.skill_text
      ? `${baseSystem}\n\n--- INSTRUÇÕES PERSONALIZADAS DO USUÁRIO ---\n${userCfg.skill_text}\n--- FIM ---`
      : baseSystem;

    const userContext = buildUserContext(payload);

    let insights: Insight[] = [];

    if (provider === "lovable" || !userCfg.api_key) {
      insights = await callLovable(model, systemPrompt, userContext);
    } else if (provider === "openai") {
      insights = await callOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        userCfg.api_key,
        model,
        systemPrompt,
        userContext,
      );
    } else if (provider === "openrouter") {
      insights = await callOpenAICompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        userCfg.api_key,
        model,
        systemPrompt,
        userContext,
      );
    } else if (provider === "anthropic") {
      insights = await callAnthropic(
        userCfg.api_key,
        model,
        systemPrompt,
        userContext,
      );
    }

    return new Response(JSON.stringify({ insights, provider, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("insights error", e);
    const msg = e instanceof Error ? e.message : "Unknown";
    const status = msg.includes("[429]")
      ? 429
      : msg.includes("[402]")
      ? 402
      : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ----- helpers -----

interface Insight {
  text: string;
  sentiment: string;
  category: string;
}

async function loadUserConfig(req: Request): Promise<UserAiConfig> {
  const fallback: UserAiConfig = {
    provider: "lovable",
    api_key: null,
    model: null,
    skill_text: null,
  };
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fallback;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return fallback;

    // Service role lê a api_key (RLS bloqueia o cliente do usuário)
    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin
      .from("ai_settings")
      .select("provider, api_key, model, skill_text")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return fallback;
    return {
      provider: (data.provider as UserAiConfig["provider"]) ?? "lovable",
      api_key: data.api_key ?? null,
      model: data.model ?? null,
      skill_text: data.skill_text ?? null,
    };
  } catch (e) {
    console.error("loadUserConfig error", e);
    return fallback;
  }
}

function buildUserContext(payload: InsightPayload): string {
  return `Período analisado: ${payload.periodDays} dias.

Métricas atuais (totais do período):
${JSON.stringify(payload.totals, null, 2)}

${
    payload.prevTotals
      ? `Período anterior (mesmos ${payload.periodDays} dias antes):\n${
        JSON.stringify(payload.prevTotals, null, 2)
      }`
      : "Sem período anterior para comparação."
  }

${
    payload.topBumps && payload.topBumps.length
      ? `Top bumps por receita:\n${
        JSON.stringify(payload.topBumps.slice(0, 3), null, 2)
      }`
      : ""
  }

${
    payload.bestWeekday
      ? `Melhor dia da semana: ${payload.bestWeekday.dia} (média ${
        payload.bestWeekday.avgVendas.toFixed(1)
      } vendas/dia)`
      : ""
  }
${
    payload.worstWeekday
      ? `Pior dia da semana: ${payload.worstWeekday.dia} (média ${
        payload.worstWeekday.avgVendas.toFixed(1)
      } vendas/dia)`
      : ""
  }

Gere 3 insights priorizando: (1) tendência mais relevante, (2) gargalo ou destaque do funil/bumps, (3) oportunidade ou alerta.`;
}

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "Frase do insight (≤22 palavras)" },
          sentiment: {
            type: "string",
            enum: ["positive", "neutral", "negative"],
          },
          category: {
            type: "string",
            enum: ["trend", "funnel", "bumps", "cost", "opportunity", "alert"],
          },
        },
        required: ["text", "sentiment", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
};

async function callLovable(
  model: string,
  system: string,
  user: string,
): Promise<Insight[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  return await callOpenAICompatible(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKey,
    model,
    system,
    user,
  );
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<Insight[]> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_insights",
            description: "Retorna 3 insights curtos sobre o desempenho.",
            parameters: TOOL_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_insights" } },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("provider error", resp.status, txt);
    throw new Error(`Provider error [${resp.status}]: ${txt.slice(0, 200)}`);
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return [];
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    return parsed.insights ?? [];
  } catch {
    return [];
  }
}

async function callAnthropic(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<Insight[]> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: "return_insights",
          description: "Retorna 3 insights curtos sobre o desempenho.",
          input_schema: TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "return_insights" },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("anthropic error", resp.status, txt);
    throw new Error(`Provider error [${resp.status}]: ${txt.slice(0, 200)}`);
  }

  const data = await resp.json();
  const toolUse = (data.content ?? []).find((c: { type: string }) =>
    c.type === "tool_use"
  );
  return toolUse?.input?.insights ?? [];
}

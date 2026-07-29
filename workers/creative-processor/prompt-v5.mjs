export const CREATIVE_ANALYSIS_PROMPT_VERSION = "creative-analysis-v5";

export const CREATIVE_ANALYSIS_OUTPUT_SCHEMA = {
  summary: "string|null",
  hook: "string|null",
  hook_timestamps: "Array<{start_ms:number,end_ms:number,label:string,reason:string}>",
  angle: "string|null",
  copy: "string|null",
  cta: "string|null",
  visual: "string|null",
  visual_evidence: "Array<{timestamp_ms:number,observation:string}>",
  tags: "string[]",
  scores: "{hook:number,clareza:number,potencial_de_escala:number}",
  analysis_coverage: '"full"|"partial"',
  errorMessage: "string|null",
};

export function buildCreativeAnalysisPrompt({
  mediaType,
  headline,
  primaryText,
  cta,
  landingUrl,
  transcriptExcerpt,
  approvedInstructions = "",
}) {
  return [
    "Analise este criativo de anúncio usando principalmente a transcrição com timestamps. Responda somente JSON válido.",
    "Campos obrigatórios: summary, hook, hook_timestamps, angle, copy, cta, visual, visual_evidence, tags, scores, analysis_coverage, errorMessage.",
    "Use PT-BR, linguagem direta, específica e sem inventar informações que não aparecem nos dados.",
    "summary: síntese original de 2 a 4 frases sobre problema, promessa, mecanismo, prova e oferta. Não copie a legenda nem repita a transcrição.",
    "hook: descreva somente o que acontece ou é dito entre 0 e 3 segundos. Use o primeiro trecho falado do vídeo; nunca use o headline/título como substituto. Se não houver evidência confiável, retorne null.",
    "hook_timestamps: array de { start_ms, end_ms, label, reason }. O primeiro item deve cobrir a abertura real, preferencialmente 0-3000 ms.",
    "angle: uma frase explicando o ângulo estratégico de persuasão (dor, desejo, crença ou mecanismo). Não copie a legenda.",
    "copy: reproduza a legenda/texto principal informado, sem transformá-la em resumo ou ângulo.",
    "cta: identifique a ação pedida. visual e visual_evidence devem deixar claro quando não há evidência visual suficiente no input.",
    "scores.hook (0-100): poder de interromper, curiosidade e clareza dos primeiros 3 segundos.",
    "scores.clareza (0-100): compreensão do problema, promessa, mecanismo, oferta e CTA.",
    "scores.potencial_de_escala (0-100): apelo amplo, replicabilidade, baixa dependência de contexto e risco de saturação/compliance.",
    "analysis_coverage: full apenas se a transcrição permitir todos os campos; caso contrário partial e explique em errorMessage.",
    approvedInstructions ? `Instruções personalizadas aprovadas:\n${approvedInstructions}` : "",
    "",
    `Tipo: ${mediaType}`,
    `Headline: ${headline ?? "—"}`,
    `Texto principal: ${primaryText ?? "—"}`,
    `CTA: ${cta ?? "—"}`,
    `Landing URL: ${landingUrl ?? "—"}`,
    "",
    "Transcrição com timestamps:",
    transcriptExcerpt,
  ].join("\n");
}

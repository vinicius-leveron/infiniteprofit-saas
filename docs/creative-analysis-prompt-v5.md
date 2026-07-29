# Prompt de análise de criativos — v5

Versão de runtime: `creative-analysis-v5`.

## Objetivo

Produzir uma análise estruturada em PT-BR, baseada prioritariamente na
transcrição com timestamps. O modelo não pode inventar evidências nem usar o
título do anúncio como substituto para o hook real do vídeo.

## Contrato de saída

```json
{
  "summary": "string|null",
  "hook": "string|null",
  "hook_timestamps": [
    { "start_ms": 0, "end_ms": 3000, "label": "string", "reason": "string" }
  ],
  "angle": "string|null",
  "copy": "string|null",
  "cta": "string|null",
  "visual": "string|null",
  "visual_evidence": [
    { "timestamp_ms": 0, "observation": "string" }
  ],
  "tags": ["string"],
  "scores": {
    "hook": 0,
    "clareza": 0,
    "potencial_de_escala": 0
  },
  "analysis_coverage": "full|partial",
  "errorMessage": "string|null"
}
```

O texto efetivamente usado pelo worker está versionado em
`workers/creative-processor/prompt-v5.mjs`. `CREATIVE_ANALYSIS_PROMPT` pode
somente acrescentar instruções previamente aprovadas; alterações no prompt
base exigem uma nova versão desse arquivo. Cada execução salva a versão e o
SHA-256 do prompt exato em `creative_asset_analysis`, sem persistir o prompt
nem a transcrição em logs.

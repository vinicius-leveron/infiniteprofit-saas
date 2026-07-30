# Migração do Render para Railway

Este diretório cobre somente os três serviços que hoje rodam no Render:

1. `infiniteprofit-saas` — frontend Vite servido por Caddy.
2. `infiniteprofit-creative-worker` — processamento de criativos.
3. `infiniteprofit-gateway-queue-consumer` — consumer da fila SQS.

Supabase, banco, Auth, Edge Functions, Storage e AWS SQS permanecem
inalterados nesta migração.

## Configuração dos serviços

Cada serviço usa o repositório inteiro como raiz e aponta para seu arquivo de
configuração em **Config as Code**:

| Serviço Railway | Arquivo de configuração |
| --- | --- |
| `infiniteprofit-web` | `/infra/railway/frontend.railway.json` |
| `infiniteprofit-creative-worker` | `/infra/railway/creative-worker.railway.json` |
| `infiniteprofit-gateway-consumer` | `/infra/railway/gateway-consumer.railway.json` |

## Variáveis

Copiar os valores diretamente do Render para Railway. Secrets não devem ser
colados em issue, chat, commit ou log.

### Frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_ENABLE_GOOGLE_AUTH`
- `VITE_ENABLE_PUBLIC_SIGNUP`
- `VITE_DISABLE_HOTMART_CHECKOUT`
- `VITE_HOTMART_CANARY_WORKSPACE_IDS`
- `VITE_APP_PUBLIC_URL`
- `VITE_SUPPORT_EMAIL`
- `VITE_STATUS_URL`
- `VITE_LEGAL_ENTITY_NAME`
- `VITE_APP_ENVIRONMENT=production`

### Worker de criativos

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CREATIVE_TRANSCRIPTION_PROVIDER`
- `CREATIVE_TRANSCRIPTION_MODEL`
- `CREATIVE_ANALYSIS_PROVIDER`
- `CREATIVE_ANALYSIS_MODEL`
- `CREATIVE_ANALYSIS_PROMPT_VERSION`
- `CREATIVE_ANALYSIS_PROMPT`
- chaves do provedor configurado, como `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` ou `LOVABLE_API_KEY`
- `CREATIVE_WORKER_POLL_INTERVAL_MS`
- `CREATIVE_WORKER_MAX_POLL_INTERVAL_MS`
- `CREATIVE_WORKER_BATCH_SIZE`
- `CREATIVE_WORKER_HEARTBEAT_INTERVAL_MS`

### Consumer do gateway

- `SUPABASE_URL`
- `AUTOMATION_KEY`
- `GATEWAY_QUEUE_URL`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `GATEWAY_QUEUE_BATCH_SIZE`
- `GATEWAY_QUEUE_WAIT_TIME_SECONDS`
- `GATEWAY_QUEUE_DELIVERY_TIMEOUT_MS`
- `GATEWAY_QUEUE_HEARTBEAT_INTERVAL_MS`

## Ordem segura

1. Subir o frontend com domínio temporário da Railway.
2. Validar login, onboarding, dashboard, integrações e importação em paralelo.
3. Subir um worker por vez e confirmar o heartbeat no Supabase.
4. Interromper o worker correspondente no Render somente depois do heartbeat.
5. Apontar o domínio para Railway após os testes de produção.
6. Manter os serviços Render suspensos, sem excluir, durante pelo menos 72 horas.
7. Excluir o Render somente após estabilidade e confirmação de que não há
   processamento pendente.

## Rollback

- Frontend: restaurar o DNS para o hostname do Render.
- Worker: suspender Railway e reativar o serviço equivalente no Render.
- Banco, Auth, funções e fila não mudam, portanto não há restauração de dados
  nesta fase.

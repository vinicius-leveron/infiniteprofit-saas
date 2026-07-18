# Arquitetura de backend para escala

## Estado e decisão

O frontend continua no Render e o control plane permanece no Supabase:

- Auth e autorização multi-tenant;
- Organização, Cliente (`workspace`) e Funil (`project`);
- credenciais e vínculos;
- read models administrativos;
- Edge Functions operacionais.

O data plane passa a ter limites explícitos:

- `raw_events` é append/upsert idempotente;
- `daily_metrics` e fórmulas não mudam;
- `sync_jobs` isola pull e agregação;
- SQS isola a ingestão crítica de checkout;
- telas administrativas consomem RPCs agregadas, nunca históricos inteiros.

Separar outro projeto Postgres só deve ocorrer quando CPU, I/O, tamanho ou
contenção comprovarem que índices, filas e compute não são suficientes. A
primeira etapa é remover amplificação de carga e estabelecer observabilidade.

## Contratos implementados

### Autenticação

- bootstrap termina em `ready` ou erro persistente;
- erro transitório não deixa skeleton infinito;
- ação explícita de retry;
- falhas 502/503/504 recebem mensagem operacional.

### Leituras operacionais

- `list_source_health_signals`;
- `list_client_operational_summaries`;
- `list_funnel_event_coverage`;
- `list_watchdog_project_statuses`.
- `get_workspace_integration_safe`;
- `list_workspace_meta_accounts_safe`;
- `list_workspace_checkout_bindings_safe`;
- `get_funnel_checkout_binding_safe`;
- `get_project_sync_settings_safe`.

Todas têm autorização no servidor, timeout de statement e retorno agregado.
O adaptador `src/lib/operationalReadApi.ts` aplica deadline do cliente e contrato
de erro único.

As tabelas que contêm credenciais não são consultáveis diretamente pelo
navegador. Tokens Meta nunca saem do backend; tokens de webhook e sincronização
só aparecem nos contratos seguros para Owner/Admin. O gate
`check:secret-boundaries` impede regressão no frontend e o gate
`ops:verify-rls` testa Member e Admin reais depois do deploy.

### Jobs

- chave determinística de deduplicação;
- claim com `FOR UPDATE SKIP LOCKED`;
- batch atômico por RPC;
- lease global de 5 min, renovada por job e liberada no `finally`, para impedir
  sobreposição entre invocações do cron;
- lote padrão de 4 jobs, orçamento de 50 s por worker e timeout de 40 s por
  chamada downstream;
- catálogo não secreto da VTurb cacheado por Cliente por 6 h e requests do
  provedor limitados a 8 s, evitando um `/players/list` por player;
- retry 5 min, 15 min, 60 min e 6 h para falhas transitórias;
- dead letter após tentativas ou imediatamente quando o provedor confirmar uma
  limitação permanente de capacidade;
- falhas terminais recebem `payload.failure.kind = permanent` e não são
  revividas pelo scheduler enquanto a integração não for corrigida;
- recovery de locks antigos;
- retenção de históricos terminados.

### Checkout

O fluxo recomendado está documentado em
`docs/architecture/gateway-durable-ingestion.md`. A resposta ao provedor não
espera mais agregação. Com SQS ativado, também não espera disponibilidade do
Postgres.

## SLOs e gates

| Superfície | Objetivo |
| --- | --- |
| Auth | 99,95% mensal; login p95 abaixo de 2 s |
| PostgREST operacional | 99,9%; p95 abaixo de 800 ms |
| Webhook ingress | 99,99%; ACK p95 abaixo de 500 ms |
| Fila de checkout | idade máxima normal abaixo de 60 s |
| Consumer de checkout | heartbeat abaixo de 120 s |
| Read model de saúde | p95 abaixo de 800 ms |
| Sync | nenhum job `running` além do lease |

O workflow `backend-canary.yml` mede frontend, Auth, PostgREST e, quando há
credenciais de QA, o contrato autenticado de saúde.

Nenhum novo lote de clientes entra quando qualquer uma destas condições ocorre:

- Auth ou PostgREST abaixo do SLO;
- banco reportado como `UNHEALTHY`;
- fila de checkout acima de 100 ou idade acima de 5 min;
- DLQ com mensagens;
- locks aguardando;
- autovacuum de `raw_events` atrasado;
- erro de RLS ou vazamento de secret;
- migrations, build ou regressão de dashboard não verdes.

## Capacidade

O compute deve ser dimensionado usando canário e teste de carga, não somente
contagem de clientes.

Sequência:

1. remover amplificação de consultas e sobreposição de workers;
2. aplicar índices/read models/workers em lote;
3. medir 24 h;
4. testar 2x o pico previsto em staging;
5. aumentar compute antes de onboarding em volume somente se Auth/REST, CPU,
   memória, conexões ou I/O não mantiverem os SLOs;
6. revisar mensalmente e antes de cada novo lote.

O pool de PostgREST não deve consumir todas as conexões diretas; é necessário
reservar capacidade para Auth, migrations, cron e operação.

## Retenção

- `sync_jobs` com sucesso: 7 dias;
- `sync_jobs` falhos: 30 dias;
- dead letter: 90 dias;
- `sync_runs` com sucesso: 30 dias;
- `sync_runs` falhos: 90 dias;
- alertas resolvidos: 90 dias;
- `raw_events`: permanece sem delete automático até existir arquivo verificado
  e testado para restauração.

O prune é diário, em lotes, para evitar transações longas.

## Rollout

1. confirmar serviços saudáveis e aumentar compute somente quando carga,
   conexões, CPU ou I/O provarem necessidade e houver aprovação financeira;
2. canário com três amostras verdes;
3. aplicar os índices de `supabase/online-migrations`, um por chamada e fora da
   transação implícita do `db push`;
4. aplicar read models e retenção;
5. testar RPCs como Owner/Admin/Moderator/Member;
6. publicar scheduler, worker e watchdog;
7. executar watchdog em `dry_run`;
8. publicar webhook com fila ainda desligada;
9. publicar frontend;
10. monitorar 30 minutos;
11. provisionar/ativar SQS por canário;
12. fazer teste de indisponibilidade controlado.

O workflow manual `backend-release.yml` valida cada índice online, aplica as
migrations transacionais, publica funções em ordem de dependência, executa os
contratos RLS e só então roda o canário. Ele exige confirmação do project ref,
secrets, usuários QA com papéis reais e environment approval.

O teste de carga é executado por `npm run ops:load`. Ele exige credenciais de QA,
falha pelos SLOs e recusa produção sem confirmação explícita. Em produção existe
um limite rígido de 10 VUs por 120 segundos; testes maiores pertencem ao staging.

O workflow `backend-staging-readiness.yml` materializa esse gate em ambiente
isolado: deploy do commit, RLS herdado, jornada de onboarding, rampas e carga
autenticada de 2x por 15 minutos. `npm run ops:readiness -- --enforce` é a
decisão final de abertura e trata qualquer evidência ausente como `hold`.

## Rollback

- frontend: voltar ao último deploy Render;
- Edge Function: redeploy da versão anterior;
- read models: manter assinatura e substituir implementação;
- índices: não remover durante incidente;
- fila: retirar `GATEWAY_QUEUE_URL`, drenar mensagens e manter DLQ;
- migrations destrutivas não fazem parte deste release.

## Evidência necessária antes de abrir onboarding

- 24 h de canário sem quebra de SLO;
- load test de 2x o pico;
- login, bootstrap e primeiro funil completos;
- Member sem secrets, logs ou ações administrativas;
- Org Admin com acesso herdado validado;
- webhook canário sobrevive a indisponibilidade do banco;
- zero mensagens não classificadas na DLQ; limitações permanentes do provedor
  podem permanecer como pendências operacionais explícitas;
- restore de backup documentado e ensaiado;
- dashboards e cálculos com regressões verdes.

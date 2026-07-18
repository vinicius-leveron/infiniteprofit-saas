# Runbook de backend, capacidade e abertura de clientes

## Objetivo

Abrir novos clientes sem repetir 500/504 de Auth, PostgREST e RPC. A operação
deve preservar isolamento entre tenants, ingestão de vendas, dashboards e
recuperação de incidentes.

## Topologia alvo

```text
Browser
  -> Render (frontend estático)
  -> Supabase Auth
  -> PostgREST / RPCs autorizadas
  -> Postgres

Gateways
  -> webhook-gateway
  -> SQS
  -> gateway-queue-consumer
  -> raw_events
  -> sync_jobs
  -> daily_metrics

Cron
  -> sync-scheduler
  -> sync_jobs
  -> sync-worker
  -> APIs Meta / VTurb / agregação
  -> sync-watchdog
```

O Postgres é control plane e data plane nesta fase. Separar bancos antes de
medir CPU, I/O, conexões e tamanho adicionaria operação sem remover as consultas
amplificadas que causaram o incidente.

## Ambientes

Antes do onboarding em volume, manter três ambientes:

| Ambiente | Dados | Uso |
| --- | --- | --- |
| Local | sintéticos | migrations e testes unitários |
| Staging | anonimizados/sintéticos representativos | RLS, carga 2x e ensaio de rollback |
| Produção | reais | tráfego de clientes e canários leves |

Staging deve usar projeto Supabase separado. Nunca executar `db reset --linked`
em produção.

## Limites e isolamento

- Browser não acessa tabelas com credenciais.
- `workspace_integrations`, `workspace_meta_accounts` e
  `project_checkout_bindings` são acessadas por RPCs/Edge Functions.
- `projects.sync_token` não está no grant de leitura do browser.
- Member recebe webhook `null` e não acessa sync settings.
- Owner/Admin recebe tokens apenas por contrato explícito.
- Jobs têm dedupe determinística, claim com `SKIP LOCKED`, lease, retry e DLQ.
- Scheduler cria no máximo 5.000 jobs por execução e grava em transações de até
  500 itens.
- Leituras operacionais têm deadline de 8 s no cliente e `statement_timeout` no
  banco.
- Consultas de tela não carregam históricos inteiros.

## Capacidade inicial

O incidente mostrou Auth, REST e DB simultaneamente `UNHEALTHY`, portanto a
primeira recuperação exige compute dedicado suficiente para respirar antes de
construir índices. Medium é o ponto inicial recomendado para a janela de
recuperação; reduzir só depois de 7 dias de telemetria verde.

Reservar conexões para:

- Auth;
- PostgREST;
- Edge Functions e workers;
- cron;
- migrations e resposta a incidentes.

Nenhum componente deve abrir conexões diretas por requisição. Workloads
serverless usam pooler em transaction mode; migrations usam conexão direta.

## Ordem do release

1. Pausar onboarding e sync manual.
2. Aumentar compute mediante aprovação financeira.
3. Aguardar Auth, REST e DB `HEALTHY`.
4. Executar `npm run ops:probe` três vezes.
5. Criar backup/PITR e registrar o ponto de restauração.
6. Executar todos os gates locais.
7. Aplicar índices online.
8. Validar que todos estão `indisvalid=true` e `indisready=true`.
9. Aplicar migrations transacionais.
10. Publicar `workspace-credentials`.
11. Publicar scheduler, worker, watchdog e webhook.
12. Executar `npm run ops:verify-rls`.
13. Rodar watchdog em dry-run.
14. Publicar frontend compatível com os novos RPCs.
15. Rodar canário por 30 minutos.
16. Executar carga no staging.
17. Abrir um lote pequeno de clientes.

O workflow `backend-release.yml` automatiza os passos 6–12 e preserva evidências
por 30 dias.

## Índices online

O Supabase CLI executa migrations comuns em uma transação implícita.
`CREATE INDEX CONCURRENTLY` não pode entrar nessa transação. Por isso:

- migrations normais ficam em `supabase/migrations`;
- índices não bloqueantes ficam em `supabase/online-migrations`;
- cada arquivo numerado contém exatamente um índice;
- `check:migration-safety` impede colocar índice concorrente no lugar errado;
- o release verifica presença e validade após a criação.

Se uma criação concorrente falhar e deixar índice inválido, parar o release.
Remover o índice inválido de forma concorrente em uma janela controlada e
reexecutar. Não confiar apenas em `IF NOT EXISTS`.

## Teste de carga

Configurar no staging:

```bash
LOAD_TEST_SUPABASE_URL=... \
LOAD_TEST_ANON_KEY=... \
LOAD_TEST_EMAIL=... \
LOAD_TEST_PASSWORD=... \
LOAD_TEST_WORKSPACE_ID=... \
LOAD_TEST_VUS=5 \
LOAD_TEST_DURATION_SECONDS=60 \
npm run ops:load
```

Executar degraus de 1, 5, 10 e 20 VUs, cinco minutos por degrau. Depois executar
2x o pico previsto por 15 minutos. Critérios:

- erros abaixo de 1%;
- Auth p95 abaixo de 2 s;
- REST e RPC de saúde p95 abaixo de 800 ms;
- sem crescimento contínuo de conexões;
- sem lock waits;
- sem aumento de DLQ;
- fila volta a zero após o teste;
- autovacuum acompanha a escrita.

Produção aceita somente canário leve, exige
`LOAD_TEST_PRODUCTION_ACK=nztnctrkmfrgclrnflfa` e limita 10 VUs/120 s.

## Abertura gradual

Abrir clientes em lotes:

1. equipe interna;
2. 3 clientes;
3. 10 clientes;
4. 25 clientes;
5. aumento semanal baseado no pico real.

Entre lotes, observar pelo menos 24 h. Interromper imediatamente se:

- Auth ou REST violar SLO;
- DB ficar `UNHEALTHY`;
- erro 5xx superar 1% por 5 min;
- p95 REST superar 1,5 s por 10 min;
- fila de checkout tiver idade acima de 5 min;
- DLQ receber mensagem;
- conexões superarem 70% sustentado;
- CPU superar 70% ou I/O ficar saturado por 15 min.

## Backup e recuperação

Metas:

- RPO de vendas: menor que 1 minuto com fila ativa;
- RPO do banco: conforme PITR contratado;
- RTO de ingestão: 30 minutos;
- RTO da aplicação administrativa: 60 minutos.

Trimestralmente:

- restaurar backup em ambiente isolado;
- verificar contagens de `raw_events`, `daily_metrics` e vínculos;
- reprocessar uma mensagem da DLQ;
- validar idempotência;
- registrar tempo real de recuperação.

## Incidente 500/504

1. Pausar onboarding, sync manual e backfills.
2. Confirmar saúde de Auth, REST e DB.
3. Medir conexões, locks, CPU, I/O e queries lentas.
4. Aumentar compute se o DB não aceita conexão.
5. Não aplicar migrations enquanto estiver `UNHEALTHY`.
6. Recuperar primeiro; depois aplicar índices e read models.
7. Manter webhook na fila durante indisponibilidade.
8. Rodar canário e RLS antes de reabrir.
9. Fazer post-mortem com linha do tempo, impacto, causa e ação preventiva.

## Rollback

- Frontend: voltar ao último deploy compatível.
- Funções: redeploy da versão anterior na ordem inversa.
- SQS: remover `GATEWAY_QUEUE_URL` apenas depois de decidir entre drenar ou
  manter o consumidor; nunca apagar DLQ.
- Read models: preservar assinatura e substituir implementação.
- Índices: manter durante incidente; remoção não é rollback emergencial.
- Grants/RLS: não reabrir tabelas de secrets para corrigir UI. Corrigir o
  contrato seguro.
- Migrations deste release não removem colunas nem dados de dashboard.

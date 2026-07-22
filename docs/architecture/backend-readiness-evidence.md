# Evidências para abertura de novos clientes

O comando canônico é:

```bash
npm run ops:readiness
```

Ele sempre imprime uma decisão única:

- `ready`: todos os gates foram comprovados;
- `hold`: pelo menos um gate falhou ou não tem evidência.

Para usar como bloqueio de release:

```bash
npm run ops:readiness -- --enforce
```

O modo `--enforce` encerra com código diferente de zero quando a decisão for
`hold`. Ausência de relatório, ambiente incorreto ou contrato diferente de
`schema_version: 1` nunca conta como sucesso.

## Evidências automáticas

O comando consulta, sem mutação:

- status do projeto Supabase;
- utilização de conexões e lock waits;
- crons esperados e crons legados;
- idade da fila, jobs presos e DLQ não classificada;
- validade dos índices críticos;
- idade do último autovacuum e proporção de tuplas mortas em `raw_events`;
- frontend, Auth e PostgREST;
- SMTP próprio, confirmação de email ativa e capacidade mínima configurada de
  30 emails transacionais por hora;
- senha mínima de 8 caracteres, usuários anônimos desativados e vinculação
  manual de identidades desativada;
- backup físico concluído nas últimas 30 horas;
- histórico de 24 horas do workflow `backend-canary.yml`;
- histórico de 24 horas do cron service-only `backend-internal-canary`;
- SQS e DLQ, quando as URLs e credenciais AWS estiverem configuradas.

O cron interno é a evidência contínua canônica: exige cobertura de pelo menos
90% dos intervalos de 15 minutos, sem falhas e sem lacunas. O GitHub Actions é
uma verificação independente; como o agendador externo pode atrasar ou omitir
execuções, ele exige seis sucessos nas últimas 24 horas, nenhum erro e uma
execução concluída nas últimas duas horas.

Variáveis para SQS:

```bash
GATEWAY_QUEUE_URL=... \
GATEWAY_DLQ_URL=... \
AWS_REGION=us-east-1 \
npm run ops:readiness
```

Use as credenciais do consumer/observabilidade. O template concede
`sqs:GetQueueAttributes` e `cloudwatch:GetMetricStatistics`; a credencial de
ingresso, limitada a `SendMessage`, não é suficiente para o gate.

## Staging e carga 2x

O workflow manual `backend-staging-readiness.yml`:

1. recusa o project ref de produção;
2. aplica o commit exato em um Supabase staging separado;
3. executa RLS com Member e Organization Admin herdado;
4. cria um usuário descartável e percorre login, bootstrap e primeiro funil;
5. prova que secrets do wizard não chegam ao `sessionStorage`;
6. executa rampas autenticadas de 1, 5, 10 e 20 VUs;
7. amostra conexões, locks, jobs expirados e DLQ durante toda a carga;
8. sustenta 2x o pico esperado por 15 minutos;
9. publica os relatórios como artifact imutável.

Configurar o environment GitHub `staging`:

### Variables

- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_PUBLISHABLE_KEY`

### Secrets

- `SUPABASE_ACCESS_TOKEN`
- `STAGING_DB_PASSWORD`
- `STAGING_SERVICE_ROLE_KEY`
- `STAGING_AUTOMATION_KEY`
- `STAGING_RLS_MEMBER_EMAIL`
- `STAGING_RLS_MEMBER_PASSWORD`
- `STAGING_RLS_ADMIN_EMAIL`
- `STAGING_RLS_ADMIN_PASSWORD`

O workflow cria ou atualiza uma fixture identificada, sem dados reais: usuários
QA, Organização, Cliente e Funil. O Admin fica somente na Organização como
Admin, sem membership explícita no Cliente; o Member recebe membership direta.
Os IDs são exportados para os passos de RLS e carga pelo `GITHUB_ENV`. A fixture
é idempotente e recusa o project ref de produção.

Depois de baixar o artifact:

```bash
READINESS_EXPECTED_PEAK_VUS=10 \
READINESS_LOAD_REPORT=artifacts/load-2x.json \
READINESS_ONBOARDING_REPORT=artifacts/staging-onboarding.json \
READINESS_RLS_REPORT=artifacts/staging-rls.json \
npm run ops:readiness
```

## Restore drill

No instante usado como ponto de restauração, capturar o baseline somente
leitura:

```bash
mkdir -p artifacts
SUPABASE_PROJECT_REF=nztnctrkmfrgclrnflfa \
node scripts/verify-restore-drill.mjs capture-baseline \
  > artifacts/restore-baseline.json
```

Restaurar o backup/PITR em outro projeto Supabase. O verificador recusa o
project ref de produção, compara contagens e vínculos, valida a migration mais
recente e testa a idempotência de `raw_events` dentro de uma transação
revertida:

```bash
RESTORE_PROJECT_REF=ref-do-restore-isolado \
RESTORE_BASELINE_REPORT=artifacts/restore-baseline.json \
RESTORE_DRILL_STARTED_AT=2026-07-18T10:00:00Z \
RESTORE_ARTIFACT_URL=https://github.com/org/repo/actions/runs/123 \
node scripts/verify-restore-drill.mjs verify \
  > artifacts/restore-drill.json
```

Incluir no gate:

```bash
READINESS_RESTORE_REPORT=artifacts/restore-drill.json \
npm run ops:readiness
```

## Indisponibilidade do consumidor/banco

O relatório do ensaio de gateway deve ser feito em staging e conter:

```json
{
  "schema_version": 1,
  "environment": "staging",
  "completed_at": "2026-07-18T12:00:00Z",
  "webhook_acknowledged_while_consumer_stopped": true,
  "message_persisted_in_queue": true,
  "delivered_once_after_resume": true,
  "duplicate_did_not_change_metrics": true,
  "dlq_depth": 0,
  "artifact_url": "https://github.com/org/repo/actions/runs/123"
}
```

O relatório vale por 30 dias. Ele só deve ser emitido depois de suspender o
consumer, receber `202`, observar a mensagem na SQS, reativar o consumer e
confirmar idempotência.

```bash
READINESS_GATEWAY_DRILL_REPORT=artifacts/gateway-drill.json \
npm run ops:readiness -- --enforce
```

## Regra de abertura

O próximo lote só entra quando o comando retornar `decision: ready`. O
relatório JSON deve ser anexado à decisão de release. Não editar relatórios
manualmente para remover um `hold`; refazer o ensaio que gerou a evidência.

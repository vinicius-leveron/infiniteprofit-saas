# Ingestão durável de webhooks de checkout

## Objetivo

Uma venda confirmada pelo gateway não pode depender da disponibilidade imediata
do Postgres. O fluxo de produção passa a ser:

```text
Gateway
  -> Edge Function webhook-gateway
  -> AWS SQS (ack 202 após persistência)
  -> gateway-queue-consumer
  -> validação de assinatura e vínculo
  -> raw_events idempotente
  -> sync_jobs aggregate
  -> daily_metrics
```

O cálculo continua sendo feito pelos componentes existentes. A fila altera apenas
durabilidade, retry e isolamento de carga.

## Garantias

- A resposta `202` só ocorre depois de o SQS retornar `MessageId`.
- Falha no SQS retorna `503`, para o gateway tentar novamente.
- O envelope é versionado e limitado a 240 KiB.
- Somente headers de assinatura conhecidos entram na fila.
- Token, assinatura e payload nunca entram nos logs estruturados.
- SQS Standard é at-least-once; `raw_events` mantém a chave idempotente
  `project_id, source, event_type, external_id`.
- O consumidor só remove a mensagem depois de receber resposta 2xx do
  processamento.
- Erros recebem backoff de visibilidade e, após oito tentativas, chegam à DLQ.
- Mensagens ficam retidas por 14 dias e são criptografadas com SSE gerenciada.

## Provisionamento

O template está em `infra/aws/gateway-webhook-queue.yaml`.

```bash
aws cloudformation deploy \
  --stack-name infiniteprofit-gateway-webhooks-production \
  --template-file infra/aws/gateway-webhook-queue.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=production \
    AlertEmail=operacoes@example.com
```

Depois do deploy:

1. Confirmar a inscrição enviada pelo SNS.
2. Criar uma access key para o usuário de ingestão.
3. Configurar no Supabase:
   `GATEWAY_QUEUE_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`.
4. Criar outra access key para o usuário consumidor.
5. Criar um worker Docker no Render usando
   `workers/gateway-queue-consumer/Dockerfile`.
6. Configurar no worker:
   `SUPABASE_URL`, `AUTOMATION_KEY`, `GATEWAY_QUEUE_URL`, `AWS_REGION`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
7. O mesmo `AUTOMATION_KEY` deve existir no Supabase e no consumidor.

As credenciais são separadas: o ingresso só pode enviar; o consumidor só pode
receber, alterar visibilidade e remover.

## Ordem de ativação

1. Provisionar fila, DLQ, alarmes e credenciais.
2. Publicar o consumidor com escala `0` ou suspenso.
3. Publicar `webhook-gateway` com `GATEWAY_QUEUE_URL` ainda ausente.
4. Configurar secrets AWS no Supabase.
5. Iniciar um consumidor.
6. Enviar evento canário assinado e confirmar:
   `202 -> SQS -> raw_events -> sync_jobs -> daily_metrics`.
7. Ativar a variável `GATEWAY_QUEUE_URL` no Supabase.
8. Monitorar idade, profundidade e DLQ durante 30 minutos.

## Rollback

- Remover somente `GATEWAY_QUEUE_URL` dos secrets da Edge Function volta ao
  processamento direto.
- Manter o consumidor ativo até a fila chegar a zero.
- Nunca apagar fila ou DLQ durante rollback.
- Reprocessar DLQ somente depois de corrigir a causa e validar a assinatura.

## Teste de indisponibilidade

1. Suspender o consumidor, sem derrubar a fila.
2. Enviar um webhook canário válido.
3. Confirmar `202` e uma mensagem visível no SQS.
4. Reativar o consumidor.
5. Confirmar persistência única em `raw_events`.
6. Reenviar a mesma mensagem e confirmar que métricas não duplicam.

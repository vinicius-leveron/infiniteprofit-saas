# Infinite Profit SaaS

Aplicação SaaS multi-tenant para operações de mídia e vendas com:

- `organizations` para a conta da agência/empresa
- `workspaces` isolados por cliente/operação
- `projects` para funis/ofertas dentro do workspace
- integrações de `Meta`, `VTurb`, `checkout`, `Sheets`

## Stack

- `Vite + React + TypeScript`
- `Supabase Auth`
- `Supabase Postgres + RLS`
- `Supabase Edge Functions`
- `pg_cron + pg_net + Vault` para automação de sync

## Setup local

1. Instale dependências:

```bash
npm install
```

2. Crie `.env`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_SUPABASE_PROJECT_ID=<project-ref>
```

3. Aplique as migrations e publique as functions.

4. Rode o app:

```bash
npm run dev
```

## Credenciais por workspace

As credenciais operacionais não ficam no `.env` do frontend.

- `Meta Ads`: salvas em `workspace_meta_accounts`
- `VTurb`: salvas em `workspace_integrations` e `workspace_vturb_players`
- `Checkout`: salvo em `workspace_integrations`, com binding por projeto em `project_checkout_bindings`

O vínculo entre credencial e funil acontece em:

- `project_meta_accounts`
- `project_vturb_players`
- `project_checkout_bindings`

## Produção: sync automático

O sync automático de `Meta` e `VTurb` roda via `pg_cron` chamando as Edge Functions `meta-pull` e `vturb-pull`.

### 1. Configure o secret interno das functions

Crie uma chave dedicada para automação:

```bash
supabase secrets set AUTOMATION_KEY=<uma-chave-forte>
```

Essa chave é usada apenas entre `pg_cron` e as Edge Functions. Ela não substitui login de usuário nem credenciais de mídia.

### 2. Salve os secrets no Vault

No SQL Editor do Supabase, crie:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<a-mesma-chave-do-AUTOMATION_KEY>', 'automation_key');
```

Se os nomes já existirem, atualize pelo dashboard do Vault ou com `vault.update_secret(...)`.

### 3. Instale ou reinstale os jobs

Depois dos secrets acima:

```sql
select * from app_private.install_sync_cron_jobs();
```

Padrões atuais:

- `sync-meta-projects`: `0 * * * *`
- `sync-vturb-projects`: `*/30 * * * *`
- payload enviado para ambas: `{"days": 2}`

### 4. Verifique os jobs

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in ('sync-meta-projects', 'sync-vturb-projects')
order by jobname;
```

E para histórico:

```sql
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 20;
```

## Produção: webhook de checkout

O checkout é `push-based`, não cron.

Cada projeto gera uma URL opaca neste formato:

```text
/functions/v1/webhook-gateway/:provider/:token
```

`provider` suportado hoje:

- `hotmart`
- `hubla`
- `kiwify`

O secret do provedor fica em `workspace_integrations.gateway_webhook_secret`.

## Functions relevantes

- `meta-pull`: sync manual e automático da Meta
- `vturb-pull`: sync manual e automático da VTurb
- `aggregate-daily`: consolidação diária
- `webhook-gateway`: ingestão de checkout por webhook
- `pull-sheet`: ingestão via Google Sheets

## Verificação

```bash
npm run build
npm test
npm run lint
```

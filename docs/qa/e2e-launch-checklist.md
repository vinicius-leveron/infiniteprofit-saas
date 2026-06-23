# QA E2E Para Lancamento

Este checklist valida o Infinite Profit como usuario real antes de disponibilizar ao mercado.

## Ambiente

- Producao: `https://infiniteprofit-saas.onrender.com`
- Projeto real inicial: Projeto Yasmin
- Projeto ID recomendado para QA: `c4f027b4-f867-4d7f-a522-dfb272c33104`

## Variaveis Opcionais Para Automacao

Crie um `.env` local ou exporte no shell:

```bash
PLAYWRIGHT_BASE_URL=https://infiniteprofit-saas.onrender.com
E2E_EMAIL=qa-admin@example.com
E2E_PASSWORD=senha-do-usuario-qa
E2E_PROJECT_ID=c4f027b4-f867-4d7f-a522-dfb272c33104
E2E_PUBLIC_SHARE_TOKEN=token-do-link-publico
E2E_AUTOMATION_KEY=automation-key-somente-para-teste-de-edge
```

Sem essas variaveis, os testes rodam apenas os fluxos publicos e pulam os fluxos autenticados.

## Comandos Pre-QA

```bash
npm run build
npm run lint
npm test
npm run qa:data
npm run qa:dashboard
npm run audit:coverage -- c4f027b4-f867-4d7f-a522-dfb272c33104
npm run e2e:install
npm run e2e
```

Para testar producao:

```bash
npm run qa:prod:data
npm run qa:prod
```

Para release bloqueante:

```bash
npm run qa:release
```

O `qa:dashboard` exige `E2E_EMAIL`, `E2E_PASSWORD` e `E2E_PROJECT_ID`. Use `QA_ALLOW_SKIPPED_E2E=1` apenas para smoke local, nunca para liberar produção.

O `qa:prod:data` audita os projetos Denise por padrão:

- `2ec7d87c-fbe5-4006-8d82-b73e24d18480` (`Perpétuo - Dra Denise`)
- `edcf2417-99af-460f-865c-f685bb4eca96` (`Perpétuo Denise`)

Para outros projetos, use `QA_PROJECT_IDS=id1,id2 npm run qa:prod:data`. Para reprocessar explicitamente as datas com raw events sem agregado, use `QA_REPROCESS=1` com `SUPABASE_URL` e `QA_AUTOMATION_KEY` configurados.

## Roteiro Manual

### 1. Acesso E Organizacao

- Criar conta nova.
- Passar pelo onboarding `/welcome`.
- Criar organizacao/workspace.
- Fazer logout/login.
- Validar que `/projects` carrega.
- Validar que usuario anonimo em `/projects` redireciona para `/auth`.

Aceite:

- Usuario novo chega em Projetos sem SQL/manual.
- Workspace aparece no topo.
- Logout/login mantem acesso correto.

### 2. Nova Operacao Via API

- Abrir `Nova operacao`.
- Criar operacao com nome real.
- Preencher Meta account/token e testar.
- Preencher VTurb API key e buscar players.
- Selecionar ou colar players.
- Preencher Hubla secret.
- Criar operacao.
- Confirmar redirecionamento para `/diagnostics?project=<id>`.

Aceite:

- Projeto nasce com `source = api`.
- Tokens nao aparecem depois de salvos.
- Operacao aparece em `/projects`.
- Diagnostico mostra pendencias se algo foi pulado.

### 3. Conexoes

- Abrir `/connections?project=<id>`.
- Confirmar contas Meta vinculadas.
- Confirmar players VTurb vinculados.
- Confirmar webhook Hubla sem placeholder.
- Copiar webhook e configurar na Hubla.
- Criar link publico em `Compartilhamento`.
- Copiar link publico.

Aceite:

- URL da Hubla fica clara.
- Botoes de copiar funcionam.
- Link publico pode ser ativado/desativado.
- Nenhum token sensivel fica visivel.

### 4. Sincronizacao

- Em Diagnostico ou Conexoes, rodar `Sincronizar Meta`.
- Rodar `Sincronizar VTurb`.
- Disparar evento Hubla real ou teste de webhook.
- Rodar `Atualizar alertas`.
- Rodar auditoria de cobertura.

Aceite:

- `raw_events` recebe Meta, VTurb e Hubla.
- `daily_metrics` e preenchido depois da agregacao.
- Diagnostico mostra ultima sync/evento.
- Erros aparecem como alerta ou toast claro.

### 5. Dashboard Macro

- Abrir `/dashboard?project=<id>`.
- Testar periodos: 7d, 15d, 30d, Tudo e personalizado.
- Validar abas: Visao Geral, Trafego, Funil VSL, Bumps, Anuncios, Atribuicao, Relatorio, Diagnostico e Simulador.
- Exportar PDF.

Aceite:

- Nenhuma aba quebra quando fonte esta ausente.
- Metrica sem dado aparece como `—` ou parcial.
- PDF exporta conteudo legivel.

### 6. VSL/VTurb

- Testar com player que tenha trafego real confirmado na VTurb.
- Comparar VTurb plataforma vs `raw_events`.
- Comparar `raw_events` vs `daily_metrics`.
- Comparar `daily_metrics` vs dashboard.
- Verificar se ha `stats_by_day`, `started_total`, `viewed_total`, `finished_total` ou `retention_curve`.

Aceite:

- Se VTurb retorna dados, dashboard mostra VSL.
- Se VTurb retorna zero, Diagnostico explica parcial/faltando.
- Pitch/retencao so aparecem como confiaveis com dado bruto suficiente.

### 7. Meta Ads

- Confirmar investimento, impressoes, cliques, CPM, CTR e CPC.
- Apos nova sync, confirmar eventos `insight`, `insight_account`, `insight_campaign`, `insight_adset`, `insight_ad`.
- Abrir aba `Anuncios`.

Aceite:

- Dashboard macro continua funcionando.
- Aba Anuncios mostra ranking com `insight_ad`.
- Falha em uma conta nao derruba o projeto inteiro.

### 8. Hubla/Webhook

- Configurar webhook Hubla com URL do projeto.
- Enviar venda aprovada, recusada, reembolso e checkout/carrinho quando disponivel.
- Confirmar eventos em Diagnostico.
- Confirmar vendas/faturamento/reembolsos no dashboard.

Aceite:

- Webhook retorna sucesso.
- Eventos aparecem em `raw_events`.
- Metricas entram em `daily_metrics`.
- Reembolso nao soma como venda positiva.

### 9. Link Publico Cliente

- Abrir link publico em aba anonima.
- Testar periodo.
- Exportar PDF.
- Confirmar que nao aparecem Conexoes, tokens, Workspace Settings, sync ou edicao.
- Desativar link e abrir novamente.

Aceite:

- Cliente ve dashboard, atribuicao e relatorio.
- Cliente nao edita nada.
- Link desativado mostra erro claro.

### 10. Permissoes

- Como admin, criar/editar operacao.
- Como membro, validar acesso conforme regra atual.
- Como usuario de outro workspace, tentar abrir URL de projeto.
- Como anonimo, tentar abrir dashboard autenticado.

Aceite:

- Usuario nao acessa workspace alheio.
- Link publico so mostra dados permitidos.
- Rotas privadas redirecionam para login.

## Bloqueadores Antes De Mercado

- `qa:data`, `qa:dashboard`, `qa:prod:data` ou `qa:release` retornando blocker.
- Qualquer raw event Meta/VTurb/Hubla sem linha correspondente em `daily_metrics` após reprocessamento.
- Import Hubla com `0` eventos reconhecidos exibindo sucesso ou fechando modal.
- Dashboard mensal mostrando apenas um dia quando existem raw events em mais datas.
- Filtro de período, data customizada ou conta Meta resetando depois de reload.
- Diagnóstico exibindo cobertura parcial/faltando sem ação recomendada.
- Job de criativo em `running` durante QA de dados.
- Validar VTurb com player que tenha trafego real; os players atuais retornaram quase tudo zero.
- Resolver alerta real `Sync meta falhou` no Projeto Yasmin antes de demo comercial.
- Definir cron automatico para `generate-alerts`.
- Revisar warnings antigos do Supabase Advisors.
- Definir politica de expiracao/retencao de links publicos.
- Criar projeto demo com dados seed para apresentacao.

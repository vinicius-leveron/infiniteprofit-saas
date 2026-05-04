

## Versão por API: Meta Ads + VTurb + Gateway de Pagamento

### Mapeamento: cada métrica da planilha → fonte real

| Bloco | Métricas | Fonte |
|---|---|---|
| **Tráfego** | Investimento, Impressões, Cliques, CPM, CTR, CPC | **Meta Marketing API** (`/insights`) |
| **VSL** | Play Rate, Retenção Pitch, Views Únicas, Chegaram no Pitch | **VTurb** (webhook de eventos `play`, `progress`, `pitch_reached`) |
| **Pageviews / Checkouts** | Pageviews, Custo por PV, Passagem p/ Checkout | **VTurb** (webhook `pageview`) + gateway (`checkout_created`) |
| **Vendas / Faturamento** | Vendas Front, Vendas Totais, Fat. Bruto, Líquido, Front, Orderbump, Funil, AOV, CAC, ROI, Lucro | **Gateway** (Hotmart/Hubla/Kiwify webhooks: `purchase.approved`, `refund`) |
| **Aprovação / Reembolso** | % Aprov. Cartão, % Aprov. Pix, Reembolsos, Valor Reembolsado, Taxa Reembolso | **Gateway** (eventos `purchase.refused`, `purchase.refunded`) |
| **Order Bumps / Upsells** | Bumps dinâmicos (count, revenue, taxa) | **Gateway** (item-level no `purchase.approved`) |

Tudo vira agregado diário pela mesma estrutura de `DailyRow` que o app já consome — zero mudança no dashboard, simulador, AI insights etc.

### Arquitetura

```text
┌─ Meta Ads API ─┐
│  (pull diário)  │──┐
└─────────────────┘  │
                     ▼
┌─ VTurb webhook ──┐ ┌─────────────────┐    ┌──────────────────┐    ┌─────────────┐
│  events streams  │─▶│ Edge Functions  │───▶│ raw_events table │───▶│ daily_metrics│──▶ App lê igual ao CSV
└──────────────────┘ │ (ingest + sync) │    │ (append-only)    │    │ (1 row/dia) │
┌─ Gateway webhook ┐ └─────────────────┘    └──────────────────┘    └─────────────┘
│  Hotmart/Hubla/  │──┘
│  Kiwify          │
└──────────────────┘
```

### Mudanças no projeto

**1. Nova noção: "data source" do projeto**
- Adicionar coluna `source` em `projects`: `csv` | `sheet` | `api`
- Páginas existentes continuam funcionando para projetos `csv`/`sheet`
- Projetos `api` ignoram `csv_content` e leem de `daily_metrics`

**2. Novas tabelas (Lovable Cloud)**
- `integrations` — credenciais por projeto: `meta_account_id`, `meta_access_token`, `vturb_player_id`, `gateway_provider`, `gateway_secret` (assinatura webhook)
- `raw_events` — append-only de tudo que entra (Meta insight, VTurb event, gateway purchase). Permite recalcular histórico
- `daily_metrics` — agregado por dia/projeto (mesma forma de `DailyRow`)
- `bump_catalog` — bumps/upsells detectados por gateway (nome, preço, tipo)

**3. Novas edge functions**
- `meta-pull` — cron diário, busca insights da Meta dos últimos N dias, grava em `raw_events` e reagrega `daily_metrics`
- `webhook-vturb` — recebe eventos do VTurb (público, valida por assinatura/secret na URL)
- `webhook-gateway` — endpoint único com sub-rotas `/hotmart`, `/hubla`, `/kiwify`, valida assinatura HMAC do provedor, normaliza payload
- `aggregate-daily` — função idempotente que recalcula `daily_metrics` de uma data a partir de `raw_events` (chamada após cada webhook + por cron)

**4. UI nova**
- Botão "Novo projeto via API" em `/projects` (ao lado de "Importar CSV" e "Sincronizar planilha")
- Tela de **Conexões** dentro do projeto: 3 cards (Meta · VTurb · Gateway) cada um com status, botão conectar/reconectar e (para webhooks) URL pra colar no painel do provedor + secret gerado
- Indicador "Última sincronização" igual ao da planilha hoje

### Sobre os tokens / credenciais necessárias

**Você ainda vai precisar fornecer:**

1. **Meta Marketing API** — não tem connector na Lovable, então:
   - Criar app em developers.facebook.com (gratuito) → System User Token com permissão `ads_read` no Business Manager → cola token + `act_<account_id>` na tela de Conexões
   - Token de System User não expira (vs. user token que expira em 60 dias)
2. **VTurb** — só URL pra colar no painel deles + secret gerado por nós. Sem token nosso lado
3. **Gateway** — idem VTurb, só configurar webhook no painel da Hotmart/Hubla/Kiwify apontando pra nossa URL. A assinatura HMAC valida origem

**Tokens que você já tem no projeto** (`LOVABLE_API_KEY`, Supabase service role) **são suficientes** pra rodar tudo isso — toda infra de edge functions, banco, secrets e cron já está paga pelo Lovable Cloud que está ativo. Não precisa de nenhum upgrade nem secret adicional do nosso lado.

### O que **não** dá pra trazer 1:1 do CSV

- **Observações gerais** → vira campo manual editável no app (input por dia)
- **Dia da semana** → calculado da data, não precisa de fonte
- **Bumps/upsells dinâmicos** → detectados pelo `product_id`/`offer_id` que vem no webhook do gateway; primeira venda de um bump novo cria entrada em `bump_catalog`

### Decisões antes de eu implementar

Tenho 3 perguntas que mudam bastante o escopo — vou perguntar separado pra não engessar agora.


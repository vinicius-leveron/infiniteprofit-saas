-- 1. Source enum + coluna em projects
DO $$ BEGIN
  CREATE TYPE public.project_source AS ENUM ('csv', 'sheet', 'api');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source public.project_source NOT NULL DEFAULT 'csv';

-- csv_content vira opcional (projetos api não têm)
ALTER TABLE public.projects ALTER COLUMN csv_content DROP NOT NULL;

-- 2. Gateway provider enum
DO $$ BEGIN
  CREATE TYPE public.gateway_provider AS ENUM ('hotmart', 'hubla', 'kiwify');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. integrations (1 por projeto)
CREATE TABLE IF NOT EXISTS public.integrations (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  -- Meta Ads
  meta_account_id TEXT,
  meta_access_token TEXT,
  meta_last_synced_at TIMESTAMPTZ,
  -- VTurb
  vturb_player_id TEXT,
  vturb_webhook_secret TEXT,
  vturb_last_event_at TIMESTAMPTZ,
  -- Gateway
  gateway_provider public.gateway_provider,
  gateway_webhook_secret TEXT,
  gateway_last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own integrations" ON public.integrations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own integrations" ON public.integrations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own integrations" ON public.integrations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own integrations" ON public.integrations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. raw_events (append-only log)
DO $$ BEGIN
  CREATE TYPE public.event_source AS ENUM ('meta', 'vturb', 'gateway');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.raw_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source public.event_source NOT NULL,
  event_type TEXT NOT NULL,        -- 'insight','play','pageview','purchase.approved','purchase.refunded',...
  event_date DATE NOT NULL,        -- dia ao qual o evento se refere (timezone do projeto = America/Sao_Paulo)
  external_id TEXT,                -- id do evento no provedor (idempotência)
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source, event_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_events_project_date ON public.raw_events (project_id, event_date);
CREATE INDEX IF NOT EXISTS idx_raw_events_source_type ON public.raw_events (source, event_type);

ALTER TABLE public.raw_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own raw events" ON public.raw_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- Inserts vêm exclusivamente das edge functions com service role (RLS bypass).

-- 5. daily_metrics (mesma forma do DailyRow)
CREATE TABLE IF NOT EXISTS public.daily_metrics (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_date DATE NOT NULL,
  -- tráfego (Meta)
  investimento NUMERIC, impressoes NUMERIC, cliques NUMERIC,
  cpm NUMERIC, ctr NUMERIC, cpc NUMERIC,
  -- vsl (VTurb)
  pageviews NUMERIC, views_unicas NUMERIC, play_rate NUMERIC,
  ret_pitch NUMERIC, chegaram_pitch NUMERIC,
  -- checkout
  checkouts NUMERIC, custo_pageview NUMERIC, custo_ic NUMERIC,
  taxa_carreg NUMERIC, pass_chk NUMERIC,
  pitch_chk NUMERIC, pitch_venda NUMERIC, chk_venda NUMERIC,
  -- vendas / faturamento (gateway)
  vendas_front NUMERIC, vendas_totais NUMERIC,
  cpa_front NUMERIC, cac NUMERIC, aov NUMERIC, roi NUMERIC, lucro NUMERIC,
  fat_bruto NUMERIC, fat_liquido NUMERIC,
  fat_front NUMERIC, fat_orderbump NUMERIC, fat_funil NUMERIC,
  -- reembolsos / aprovação
  reembolsos NUMERIC, taxa_reembolso NUMERIC, valor_reembolsado NUMERIC,
  aprov_cartao NUMERIC, aprov_pix NUMERIC,
  -- derivados
  conv_geral_orderbump NUMERIC, proporcao_funil_front NUMERIC,
  -- editáveis manualmente
  obs TEXT DEFAULT '',
  -- bumps por dia (array dinâmico {bump_id, count, revenue})
  bumps JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_user ON public.daily_metrics (user_id, event_date DESC);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own daily metrics" ON public.daily_metrics
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own daily metrics obs" ON public.daily_metrics
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Inserts/aggregations feitas pelo service role.

CREATE TRIGGER trg_daily_metrics_updated_at
  BEFORE UPDATE ON public.daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. bump_catalog
DO $$ BEGIN
  CREATE TYPE public.bump_kind AS ENUM ('orderbump', 'upsell', 'downsell');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.bump_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  external_id TEXT NOT NULL,    -- product_id / offer_id no gateway
  name TEXT NOT NULL,
  price NUMERIC,
  kind public.bump_kind NOT NULL DEFAULT 'orderbump',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, external_id)
);

ALTER TABLE public.bump_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own bump catalog" ON public.bump_catalog
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own bump catalog" ON public.bump_catalog
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
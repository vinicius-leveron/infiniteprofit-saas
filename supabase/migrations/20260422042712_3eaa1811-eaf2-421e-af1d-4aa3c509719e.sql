CREATE TABLE IF NOT EXISTS public.meta_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  account_id TEXT NOT NULL,        -- ex: act_1234567890
  access_token TEXT NOT NULL,
  label TEXT,                       -- apelido amigável
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_accounts_project ON public.meta_accounts(project_id);

ALTER TABLE public.meta_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own meta accounts" ON public.meta_accounts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own meta accounts" ON public.meta_accounts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own meta accounts" ON public.meta_accounts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own meta accounts" ON public.meta_accounts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_meta_accounts_updated_at
  BEFORE UPDATE ON public.meta_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- account_id em raw_events (opcional; só preenchido em eventos Meta)
ALTER TABLE public.raw_events
  ADD COLUMN IF NOT EXISTS account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_events_project_date_account
  ON public.raw_events (project_id, event_date, account_id);
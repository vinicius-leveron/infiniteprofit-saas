-- 1) Renomear vturb_webhook_secret -> vturb_api_key e remover vturb_player_id
ALTER TABLE public.integrations
  RENAME COLUMN vturb_webhook_secret TO vturb_api_key;

ALTER TABLE public.integrations
  DROP COLUMN IF EXISTS vturb_player_id;

-- 2) Nova tabela: vturb_players (espelha meta_accounts)
CREATE TABLE public.vturb_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  player_id text NOT NULL,
  label text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, player_id)
);

ALTER TABLE public.vturb_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own vturb players"
  ON public.vturb_players FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own vturb players"
  ON public.vturb_players FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own vturb players"
  ON public.vturb_players FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own vturb players"
  ON public.vturb_players FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_vturb_players_updated_at
  BEFORE UPDATE ON public.vturb_players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX vturb_players_project_idx ON public.vturb_players(project_id);
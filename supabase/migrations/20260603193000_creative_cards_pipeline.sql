DO $$
BEGIN
  ALTER TYPE public.sync_source ADD VALUE IF NOT EXISTS 'creative';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('creative-assets', 'creative-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.creative_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  creative_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'unknown' CHECK (media_type IN ('video', 'image', 'unknown')),
  thumbnail_url TEXT,
  media_storage_path TEXT,
  headline TEXT,
  primary_text TEXT,
  cta TEXT,
  landing_url TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'processing', 'ready', 'failed', 'missing_media')),
  last_meta_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, asset_key)
);

CREATE INDEX IF NOT EXISTS idx_creative_assets_project_status
  ON public.creative_assets (project_id, analysis_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_creative_assets_project_media_type
  ON public.creative_assets (project_id, media_type);

ALTER TABLE public.creative_assets ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_creative_assets_updated_at
  BEFORE UPDATE ON public.creative_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.creative_asset_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.creative_assets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  creative_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  first_seen_at DATE,
  last_seen_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, asset_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_creative_asset_ads_project_asset
  ON public.creative_asset_ads (project_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_creative_asset_ads_project_ad
  ON public.creative_asset_ads (project_id, ad_id);

ALTER TABLE public.creative_asset_ads ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_creative_asset_ads_updated_at
  BEFORE UPDATE ON public.creative_asset_ads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.creative_asset_daily_metrics (
  asset_id UUID NOT NULL REFERENCES public.creative_assets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_date DATE NOT NULL,
  spend NUMERIC NOT NULL DEFAULT 0,
  impressions NUMERIC NOT NULL DEFAULT 0,
  clicks NUMERIC NOT NULL DEFAULT 0,
  outbound_clicks NUMERIC NOT NULL DEFAULT 0,
  ctr NUMERIC,
  link_ctr NUMERIC,
  cpm NUMERIC,
  purchases NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  roas NUMERIC,
  cpa NUMERIC,
  hook_rate NUMERIC,
  has_meta_data BOOLEAN NOT NULL DEFAULT false,
  has_gateway_data BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_creative_asset_daily_metrics_project_date
  ON public.creative_asset_daily_metrics (project_id, event_date DESC);

ALTER TABLE public.creative_asset_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_creative_asset_daily_metrics_updated_at
  BEFORE UPDATE ON public.creative_asset_daily_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.creative_asset_analysis (
  asset_id UUID PRIMARY KEY REFERENCES public.creative_assets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'missing_media')),
  transcript TEXT,
  summary TEXT,
  hook TEXT,
  angle TEXT,
  copy TEXT,
  cta TEXT,
  visual TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creative_asset_analysis_project_status
  ON public.creative_asset_analysis (project_id, status, processed_at DESC);

ALTER TABLE public.creative_asset_analysis ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_creative_asset_analysis_updated_at
  BEFORE UPDATE ON public.creative_asset_analysis
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.creative_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_creative_groups_project_created
  ON public.creative_groups (project_id, created_at DESC);

ALTER TABLE public.creative_groups ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_creative_groups_updated_at
  BEFORE UPDATE ON public.creative_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Workspace members can view creative assets"
ON public.creative_assets FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage creative assets"
ON public.creative_assets FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can update creative assets"
ON public.creative_assets FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view creative asset ads"
ON public.creative_asset_ads FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage creative asset ads"
ON public.creative_asset_ads FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can update creative asset ads"
ON public.creative_asset_ads FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view creative asset daily metrics"
ON public.creative_asset_daily_metrics FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage creative asset daily metrics"
ON public.creative_asset_daily_metrics FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can update creative asset daily metrics"
ON public.creative_asset_daily_metrics FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view creative asset analysis"
ON public.creative_asset_analysis FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage creative asset analysis"
ON public.creative_asset_analysis FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can update creative asset analysis"
ON public.creative_asset_analysis FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view creative groups"
ON public.creative_groups FOR SELECT
TO authenticated
USING (
  app_private.is_workspace_member(workspace_id)
  AND (
    visibility = 'workspace'
    OR user_id = auth.uid()
  )
);

CREATE POLICY "Workspace admins can manage creative groups"
ON public.creative_groups FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can update creative groups"
ON public.creative_groups FOR UPDATE
TO authenticated
USING (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
)
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can delete creative groups"
ON public.creative_groups FOR DELETE
TO authenticated
USING (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

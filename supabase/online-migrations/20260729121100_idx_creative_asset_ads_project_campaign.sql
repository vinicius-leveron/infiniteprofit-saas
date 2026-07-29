create index concurrently if not exists idx_creative_asset_ads_project_campaign
  on public.creative_asset_ads (project_id, campaign_id, adset_id, ad_id);

alter table public.creative_asset_daily_metrics
  add column if not exists refunds numeric not null default 0,
  add column if not exists refund_rate numeric;

do $$
begin
  alter type public.workspace_role add value if not exists 'moderator';
exception
  when duplicate_object then null;
end $$;

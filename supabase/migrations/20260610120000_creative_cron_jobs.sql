-- Enable required extensions
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Grant necessary permissions
grant usage on schema cron to postgres;
grant usage on schema net to postgres;

-- Create config table for cron settings (if not exists)
create table if not exists public.cron_config (
  key text primary key,
  value text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Insert config values (will be updated manually with actual values)
insert into public.cron_config (key, value) values
  ('supabase_url', 'https://nztnctrkmfrgclrnflfa.supabase.co'),
  ('automation_key', 'REPLACE_WITH_AUTOMATION_KEY')
on conflict (key) do nothing;

-- RLS for cron_config (only service role can access)
alter table public.cron_config enable row level security;

create policy "Service role only" on public.cron_config
  for all using (false);

-- Function to call meta-pull
create or replace function public.cron_meta_pull()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from cron_config where key = 'supabase_url';
  select value into v_key from cron_config where key = 'automation_key';

  if v_url is null or v_key is null or v_key = 'REPLACE_WITH_AUTOMATION_KEY' then
    raise notice 'Cron config not set. Please update cron_config table.';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/meta-pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := jsonb_build_object('days', 7)::jsonb
  );
end;
$$;

-- Function to call creative-sync
create or replace function public.cron_creative_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from cron_config where key = 'supabase_url';
  select value into v_key from cron_config where key = 'automation_key';

  if v_url is null or v_key is null or v_key = 'REPLACE_WITH_AUTOMATION_KEY' then
    raise notice 'Cron config not set. Please update cron_config table.';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/creative-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := jsonb_build_object('days', 7)::jsonb
  );
end;
$$;

-- Schedule jobs
-- Meta-pull: 6:00 AM UTC daily
select cron.schedule(
  'daily-meta-pull',
  '0 6 * * *',
  $$select public.cron_meta_pull()$$
);

-- Creative-sync: 6:30 AM, 12:00 PM, 6:00 PM UTC
select cron.schedule(
  'daily-creative-sync-morning',
  '30 6 * * *',
  $$select public.cron_creative_sync()$$
);

select cron.schedule(
  'daily-creative-sync-midday',
  '0 12 * * *',
  $$select public.cron_creative_sync()$$
);

select cron.schedule(
  'daily-creative-sync-evening',
  '0 18 * * *',
  $$select public.cron_creative_sync()$$
);

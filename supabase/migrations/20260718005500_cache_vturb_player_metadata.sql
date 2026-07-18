-- Cache VTurb catalog metadata at the Client boundary. Recurring player syncs
-- can then avoid calling /players/list once per player.

alter table public.workspace_vturb_players
  add column if not exists video_duration double precision,
  add column if not exists pitch_time double precision,
  add column if not exists metadata_synced_at timestamptz;

comment on column public.workspace_vturb_players.video_duration is
  'Cached VTurb player duration used by analytics requests.';
comment on column public.workspace_vturb_players.pitch_time is
  'Cached VTurb pitch time used by analytics requests.';
comment on column public.workspace_vturb_players.metadata_synced_at is
  'Last successful refresh of the non-secret VTurb player catalog metadata.';

create or replace function public.refresh_workspace_vturb_metadata(
  _workspace_id uuid,
  _players jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  affected integer := 0;
begin
  if pg_catalog.jsonb_typeof(_players) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'VTurb players payload must be an array';
  end if;

  if pg_catalog.jsonb_array_length(_players) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'VTurb players payload exceeds 1000 items';
  end if;

  with metadata as (
    select
      pg_catalog.btrim(item ->> 'id') as player_id,
      nullif(pg_catalog.btrim(item ->> 'name'), '') as player_name,
      nullif(item ->> 'duration', '')::double precision as video_duration,
      nullif(item ->> 'pitch_time', '')::double precision as pitch_time
    from pg_catalog.jsonb_array_elements(_players) item
    where nullif(pg_catalog.btrim(item ->> 'id'), '') is not null
  )
  update public.workspace_vturb_players player
  set
    label = coalesce(metadata.player_name, player.label),
    video_duration = metadata.video_duration,
    pitch_time = metadata.pitch_time,
    metadata_synced_at = pg_catalog.now()
  from metadata
  where player.workspace_id = _workspace_id
    and player.player_id = metadata.player_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.refresh_workspace_vturb_metadata(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.refresh_workspace_vturb_metadata(uuid, jsonb)
  to service_role;

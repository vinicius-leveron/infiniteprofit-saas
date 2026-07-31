-- PostgREST sessions start with an 8 second statement timeout. The dimension
-- refresh used to rescan every historical checkout on every small daily
-- refresh, which made the filter read model fail while daily_metrics still
-- succeeded. Limit attribution work to the requested dates and skip expensive
-- UTM matching when a provider already supplied ad_id.

do $migration$
declare
  definition text;
  previous_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.refresh_dashboard_ad_dimensions(uuid,date[])'::regprocedure
  )
  into definition;

  if definition is null then
    raise exception 'refresh_dashboard_ad_dimensions_not_found';
  end if;

  previous_definition := definition;
  definition := pg_catalog.replace(
    definition,
    $old$
      where link.project_id = _project_id
        and nullif(event.payload->>'utm_content', '') is not null
$old$,
    $new$
      where link.project_id = _project_id
        and nullif(event.payload->>'ad_id', '') is null
        and nullif(event.payload->>'utm_content', '') is not null
$new$
  );
  if definition = previous_definition then
    raise exception 'dashboard_dimension_utm_guard_patch_not_applied';
  end if;

  previous_definition := definition;
  definition := pg_catalog.replace(
    definition,
    $old$
      and coalesce(event.payload->>'transaction_id', event.external_id) is not null
$old$,
    $new$
      and coalesce(event.payload->>'transaction_id', event.external_id) is not null
      and (_dates is null or event.event_date = any(_dates))
$new$
  );
  if definition = previous_definition then
    raise exception 'dashboard_dimension_date_scope_patch_not_applied';
  end if;

  execute definition;
end;
$migration$;

alter function public.refresh_dashboard_ad_dimensions(uuid, date[])
  set statement_timeout to '35s';


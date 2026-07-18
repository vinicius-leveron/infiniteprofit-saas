do $$
declare
  missing_indexes text[];
  invalid_indexes text[];
begin
  with expected(index_name) as (
    values
      ('idx_raw_events_project_received'),
      ('idx_raw_events_project_source_received'),
      ('idx_sync_runs_project_created'),
      ('idx_sync_runs_project_source_status_started'),
      ('idx_operational_alerts_project_source_status'),
      ('idx_sync_jobs_terminal_finished')
  )
  select array_agg(expected.index_name order by expected.index_name)
    into missing_indexes
  from expected
  where pg_catalog.to_regclass(
    pg_catalog.format('public.%I', expected.index_name)
  ) is null;

  if coalesce(pg_catalog.cardinality(missing_indexes), 0) > 0 then
    raise exception 'Missing online indexes: %',
      pg_catalog.array_to_string(missing_indexes, ', ');
  end if;

  with expected(index_name) as (
    values
      ('idx_raw_events_project_received'),
      ('idx_raw_events_project_source_received'),
      ('idx_sync_runs_project_created'),
      ('idx_sync_runs_project_source_status_started'),
      ('idx_operational_alerts_project_source_status'),
      ('idx_sync_jobs_terminal_finished')
  )
  select array_agg(expected.index_name order by expected.index_name)
    into invalid_indexes
  from expected
  join pg_catalog.pg_class relation
    on relation.oid = pg_catalog.to_regclass(
      pg_catalog.format('public.%I', expected.index_name)
    )
  join pg_catalog.pg_index index_state
    on index_state.indexrelid = relation.oid
  where not index_state.indisvalid
    or not index_state.indisready;

  if coalesce(pg_catalog.cardinality(invalid_indexes), 0) > 0 then
    raise exception 'Invalid online indexes: %',
      pg_catalog.array_to_string(invalid_indexes, ', ');
  end if;
end;
$$;

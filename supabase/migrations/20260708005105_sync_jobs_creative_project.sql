ALTER TABLE public.sync_jobs
  DROP CONSTRAINT IF EXISTS sync_jobs_source_check;

ALTER TABLE public.sync_jobs
  ADD CONSTRAINT sync_jobs_source_check
  CHECK (source IN ('meta', 'vturb', 'gateway', 'aggregate', 'creative'));

ALTER TABLE public.sync_jobs
  DROP CONSTRAINT IF EXISTS sync_jobs_entity_type_check;

ALTER TABLE public.sync_jobs
  ADD CONSTRAINT sync_jobs_entity_type_check
  CHECK (entity_type IN ('meta_account', 'vturb_player', 'hubla_reconcile', 'aggregate_project_dates', 'creative_project'));

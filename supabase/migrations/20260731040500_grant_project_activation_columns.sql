-- Project reads are intentionally column-scoped because the legacy table still
-- contains csv_content. Every safe activation column added after that boundary
-- must therefore be granted explicitly.

grant select (
  first_trusted_signal_at,
  activation_source,
  first_dashboard_opened_at
) on table public.projects to authenticated;

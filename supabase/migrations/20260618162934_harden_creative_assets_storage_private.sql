-- Prepare creative-assets for private-bucket operation.
--
-- Do not flip storage.buckets.public to false in this migration yet. The
-- production audit found many legacy rows that still point at public object
-- URLs without a matching media_storage_path. The application now prefers
-- signed URLs for rows with storage paths; after backfilling legacy rows, run a
-- planned follow-up migration to make the bucket private.

insert into storage.buckets (id, name, public)
values ('creative-assets', 'creative-assets', true)
on conflict (id) do nothing;

drop policy if exists "Workspace members can read creative storage objects"
  on storage.objects;

create policy "Workspace members can read creative storage objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'creative-assets'
  and exists (
    select 1
    from public.projects project
    where project.id::text = (storage.foldername(name))[1]
      and app_private.is_workspace_member(project.workspace_id)
  )
);

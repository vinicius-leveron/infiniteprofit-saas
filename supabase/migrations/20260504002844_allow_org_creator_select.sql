CREATE POLICY "Creators can view owned organizations"
ON public.organizations FOR SELECT
TO authenticated
USING (auth.uid() = created_by);

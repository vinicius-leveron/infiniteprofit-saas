-- Política explícita de bloqueio: nada é exposto via API direta.
-- Todo acesso deve passar pelas RPCs SECURITY DEFINER (get_my_ai_settings_safe, upsert_my_ai_settings, delete_my_ai_settings).
CREATE POLICY "Deny all direct access" ON public.ai_settings
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
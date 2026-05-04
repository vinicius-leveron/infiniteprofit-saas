-- Tabela de configurações de IA por usuário
CREATE TABLE public.ai_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'lovable' CHECK (provider IN ('lovable','openai','anthropic','openrouter')),
  api_key TEXT,
  model TEXT,
  skill_text TEXT CHECK (skill_text IS NULL OR length(skill_text) <= 10000),
  skill_file_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

-- Sem políticas SELECT/UPDATE/INSERT diretas para o cliente.
-- Acesso à api_key acontece SOMENTE via RPC SECURITY DEFINER abaixo.
-- (Sem policies = nenhum acesso direto via PostgREST do client. Edge functions usam service role.)

CREATE OR REPLACE FUNCTION public.get_my_ai_settings_safe()
RETURNS TABLE (
  provider TEXT,
  model TEXT,
  skill_text TEXT,
  skill_file_name TEXT,
  has_api_key BOOLEAN,
  api_key_last4 TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    s.provider,
    s.model,
    s.skill_text,
    s.skill_file_name,
    (s.api_key IS NOT NULL AND length(s.api_key) > 0) AS has_api_key,
    CASE
      WHEN s.api_key IS NOT NULL AND length(s.api_key) >= 4
      THEN right(s.api_key, 4)
      ELSE NULL
    END AS api_key_last4,
    s.updated_at
  FROM public.ai_settings s
  WHERE s.user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_my_ai_settings(
  _provider TEXT,
  _api_key TEXT,
  _model TEXT,
  _skill_text TEXT,
  _skill_file_name TEXT,
  _clear_api_key BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  existing_key TEXT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _provider NOT IN ('lovable','openai','anthropic','openrouter') THEN
    RAISE EXCEPTION 'Invalid provider';
  END IF;

  IF _skill_text IS NOT NULL AND length(_skill_text) > 10000 THEN
    RAISE EXCEPTION 'Skill text exceeds 10000 chars';
  END IF;

  -- Preserva a chave existente quando _api_key é NULL e _clear_api_key=false
  SELECT api_key INTO existing_key FROM public.ai_settings WHERE user_id = uid;

  INSERT INTO public.ai_settings (user_id, provider, api_key, model, skill_text, skill_file_name, updated_at)
  VALUES (
    uid,
    _provider,
    CASE
      WHEN _clear_api_key THEN NULL
      WHEN _api_key IS NOT NULL AND length(_api_key) > 0 THEN _api_key
      ELSE existing_key
    END,
    _model,
    _skill_text,
    _skill_file_name,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    api_key = EXCLUDED.api_key,
    model = EXCLUDED.model,
    skill_text = EXCLUDED.skill_text,
    skill_file_name = EXCLUDED.skill_file_name,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_ai_settings()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM public.ai_settings WHERE user_id = auth.uid();
END;
$$;

-- Concede execução das RPCs ao role authenticated
GRANT EXECUTE ON FUNCTION public.get_my_ai_settings_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_ai_settings(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_ai_settings() TO authenticated;
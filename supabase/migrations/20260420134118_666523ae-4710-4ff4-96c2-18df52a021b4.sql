-- Tabela para histórico de simulações do simulador de cenários
CREATE TABLE public.simulations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID,
  name TEXT,
  inputs JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index para listar rápido por usuário/projeto
CREATE INDEX idx_simulations_user_project ON public.simulations (user_id, project_id, created_at DESC);

-- Ativa RLS
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;

-- Policies: cada usuário só mexe nas próprias simulações
CREATE POLICY "Users can view their own simulations"
ON public.simulations FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own simulations"
ON public.simulations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own simulations"
ON public.simulations FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own simulations"
ON public.simulations FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
ALTER TABLE public.meli_monitoramento_snapshots
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

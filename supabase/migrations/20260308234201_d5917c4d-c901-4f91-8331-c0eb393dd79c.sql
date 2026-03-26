
-- =====================================================
-- INVESTIGATION DOSSIERS
-- =====================================================
CREATE TABLE public.investigation_dossiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  -- status: 'open' | 'in_progress' | 'closed'
  priority TEXT NOT NULL DEFAULT 'medium',
  -- priority: 'low' | 'medium' | 'high' | 'critical'
  assigned_to UUID,
  closed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.investigation_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dossiers"
  ON public.investigation_dossiers FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'superadmin'::app_role) OR has_role(auth.uid(), 'org_admin'::app_role));

CREATE POLICY "Users can insert own dossiers"
  ON public.investigation_dossiers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dossiers"
  ON public.investigation_dossiers FOR UPDATE
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'superadmin'::app_role) OR has_role(auth.uid(), 'org_admin'::app_role));

CREATE POLICY "Users can delete own dossiers"
  ON public.investigation_dossiers FOR DELETE
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE TRIGGER update_investigation_dossiers_updated_at
  BEFORE UPDATE ON public.investigation_dossiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Linked transactions (many-to-many)
CREATE TABLE public.dossier_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dossier_id UUID NOT NULL REFERENCES public.investigation_dossiers(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(dossier_id, transaction_id)
);

ALTER TABLE public.dossier_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage dossier transactions"
  ON public.dossier_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.investigation_dossiers d
      WHERE d.id = dossier_id AND (
        d.user_id = auth.uid()
        OR has_role(auth.uid(), 'superadmin'::app_role)
        OR has_role(auth.uid(), 'org_admin'::app_role)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.investigation_dossiers d
      WHERE d.id = dossier_id AND (
        d.user_id = auth.uid()
        OR has_role(auth.uid(), 'superadmin'::app_role)
        OR has_role(auth.uid(), 'org_admin'::app_role)
      )
    )
  );

-- Dossier notes / timeline
CREATE TABLE public.dossier_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dossier_id UUID NOT NULL REFERENCES public.investigation_dossiers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'note',
  -- note_type: 'note' | 'action' | 'status_change' | 'evidence'
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dossier_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dossier notes"
  ON public.dossier_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.investigation_dossiers d
      WHERE d.id = dossier_id AND (
        d.user_id = auth.uid()
        OR has_role(auth.uid(), 'superadmin'::app_role)
        OR has_role(auth.uid(), 'org_admin'::app_role)
        OR has_role(auth.uid(), 'analyst'::app_role)
        OR has_role(auth.uid(), 'forensic_analyst'::app_role)
      )
    )
  );

CREATE POLICY "Users can add dossier notes"
  ON public.dossier_notes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.investigation_dossiers d
      WHERE d.id = dossier_id AND (
        d.user_id = auth.uid()
        OR has_role(auth.uid(), 'superadmin'::app_role)
        OR has_role(auth.uid(), 'org_admin'::app_role)
        OR has_role(auth.uid(), 'analyst'::app_role)
        OR has_role(auth.uid(), 'forensic_analyst'::app_role)
      )
    )
  );

-- Enable realtime for dossiers
ALTER PUBLICATION supabase_realtime ADD TABLE public.investigation_dossiers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dossier_notes;

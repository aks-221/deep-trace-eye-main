
-- =====================================================
-- 1. NOTIFICATIONS TABLE (persistent critical alerts)
-- =====================================================
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'critical_aml',
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB,
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast retrieval
CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;


-- =====================================================
-- 2. AML RULES TABLE (configurable scoring rules)
-- =====================================================
CREATE TABLE public.aml_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL DEFAULT 'threshold',
  -- rule_type: 'threshold' | 'channel' | 'typology' | 'velocity'
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 5,
  -- Threshold rule params
  amount_threshold NUMERIC,
  amount_operator TEXT DEFAULT '>',  -- '>', '>=', '<', '<=', '='
  -- Channel rule params
  target_channels TEXT[],
  -- Typology / keyword params
  typology_keywords TEXT[],
  -- Velocity rule params
  velocity_count INTEGER,
  velocity_window_hours INTEGER DEFAULT 24,
  -- Score impact
  score_impact INTEGER NOT NULL DEFAULT 10,
  score_action TEXT NOT NULL DEFAULT 'signaler',
  -- score_action: 'signaler' | 'declarer_STR' | 'bloquer' | 'surveiller'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.aml_rules ENABLE ROW LEVEL SECURITY;

-- Compliance managers, org admins and superadmins can manage rules
CREATE POLICY "Managers can view AML rules"
  ON public.aml_rules FOR SELECT
  USING (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'org_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_manager'::app_role)
  );

CREATE POLICY "Managers can insert AML rules"
  ON public.aml_rules FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      has_role(auth.uid(), 'superadmin'::app_role)
      OR has_role(auth.uid(), 'org_admin'::app_role)
      OR has_role(auth.uid(), 'compliance_manager'::app_role)
    )
  );

CREATE POLICY "Managers can update AML rules"
  ON public.aml_rules FOR UPDATE
  USING (
    auth.uid() = user_id
    AND (
      has_role(auth.uid(), 'superadmin'::app_role)
      OR has_role(auth.uid(), 'org_admin'::app_role)
      OR has_role(auth.uid(), 'compliance_manager'::app_role)
    )
  );

CREATE POLICY "Managers can delete AML rules"
  ON public.aml_rules FOR DELETE
  USING (
    auth.uid() = user_id
    AND (
      has_role(auth.uid(), 'superadmin'::app_role)
      OR has_role(auth.uid(), 'org_admin'::app_role)
      OR has_role(auth.uid(), 'compliance_manager'::app_role)
    )
  );

-- Analysts can read org rules (view-only)
CREATE POLICY "Analysts can view AML rules"
  ON public.aml_rules FOR SELECT
  USING (
    has_role(auth.uid(), 'analyst'::app_role)
    OR has_role(auth.uid(), 'forensic_analyst'::app_role)
    OR has_role(auth.uid(), 'auditor'::app_role)
  );

-- Timestamp trigger
CREATE TRIGGER update_aml_rules_updated_at
  BEFORE UPDATE ON public.aml_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

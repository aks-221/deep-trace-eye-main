-- Create compliance_checklist table for BCEAO/CENTIF
CREATE TABLE IF NOT EXISTS public.compliance_checklist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own compliance items" ON public.compliance_checklist FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own compliance items" ON public.compliance_checklist FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own compliance items" ON public.compliance_checklist FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own compliance items" ON public.compliance_checklist FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_compliance_checklist_updated_at
  BEFORE UPDATE ON public.compliance_checklist
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create STR (Suspicious Transaction Reports) table
CREATE TABLE IF NOT EXISTS public.str_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  reference TEXT NOT NULL DEFAULT ('STR-' || extract(year from now())::text || '-' || lpad(floor(random()*9999)::text, 4, '0')),
  subject_name TEXT NOT NULL,
  subject_account TEXT,
  transaction_amount NUMERIC DEFAULT 0,
  transaction_date DATE DEFAULT CURRENT_DATE,
  transaction_channel TEXT DEFAULT 'Bank',
  suspicious_nature TEXT NOT NULL,
  narrative TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.str_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own STR reports" ON public.str_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own STR reports" ON public.str_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own STR reports" ON public.str_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own STR reports" ON public.str_reports FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_str_reports_updated_at
  BEFORE UPDATE ON public.str_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
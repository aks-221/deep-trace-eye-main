
-- Function: auto-create notifications for compliance roles when a STR reaches pending_approval
CREATE OR REPLACE FUNCTION public.notify_str_pending_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status changes TO pending_approval
  IF (OLD.status IS DISTINCT FROM NEW.status) AND NEW.status = 'pending_approval' THEN
    -- Insert a notification for every user with compliance_manager, org_admin or superadmin role
    INSERT INTO public.notifications (user_id, title, body, type, metadata)
    SELECT
      ur.user_id,
      '🚨 STR en attente d''approbation',
      'Réf: ' || NEW.reference || ' · Sujet: ' || NEW.subject_name ||
        ' · ' || COALESCE(to_char(NEW.transaction_amount, 'FM999G999G990'), '0') || ' XOF',
      'compliance',
      jsonb_build_object(
        'module',     'str_workflow',
        'strId',      NEW.id,
        'txRef',      NEW.reference,
        'riskScore',  85,
        'action',     'Examiner & Approuver'
      )
    FROM public.user_roles ur
    WHERE ur.role IN ('compliance_manager', 'org_admin', 'superadmin')
      AND ur.user_id <> NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on str_reports
DROP TRIGGER IF EXISTS trg_str_pending_approval_notify ON public.str_reports;
CREATE TRIGGER trg_str_pending_approval_notify
AFTER UPDATE ON public.str_reports
FOR EACH ROW
EXECUTE FUNCTION public.notify_str_pending_approval();

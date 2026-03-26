
-- Function to get cron jobs list (security definer to access cron schema)
CREATE OR REPLACE FUNCTION public.get_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  database text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT jobid, jobname, schedule, active, database
  FROM cron.job
  ORDER BY jobid;
$$;

-- Function to get recent cron run details (last 30)
CREATE OR REPLACE FUNCTION public.get_cron_runs()
RETURNS TABLE (
  runid bigint,
  jobid bigint,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz,
  duration_ms double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT
    runid,
    jobid,
    status,
    return_message,
    start_time,
    end_time,
    EXTRACT(EPOCH FROM (end_time - start_time)) * 1000 AS duration_ms
  FROM cron.job_run_details
  ORDER BY start_time DESC
  LIMIT 30;
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_jobs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_runs() TO authenticated, service_role;

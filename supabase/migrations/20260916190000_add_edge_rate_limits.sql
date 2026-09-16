-- Small, database-backed rate limiter for authenticated Edge Functions.
-- Browser clients never call this function directly; only the service role can.

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _bucket_key text,
  _max_requests integer,
  _window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket public.rate_limit_buckets%ROWTYPE;
BEGIN
  IF _bucket_key IS NULL OR length(_bucket_key) = 0
    OR _max_requests < 1 OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate-limit parameters' USING ERRCODE = '22023';
  END IF;

  -- Keep cleanup work rare and bounded so normal requests stay cheap.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_buckets
    WHERE updated_at < now() - interval '1 day';
  END IF;

  INSERT INTO public.rate_limit_buckets (bucket_key, window_started_at, request_count, updated_at)
  VALUES (_bucket_key, now(), 0, now())
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT * INTO bucket
  FROM public.rate_limit_buckets
  WHERE bucket_key = _bucket_key
  FOR UPDATE;

  IF bucket.window_started_at <= now() - make_interval(secs => _window_seconds) THEN
    UPDATE public.rate_limit_buckets
    SET window_started_at = now(), request_count = 1, updated_at = now()
    WHERE bucket_key = _bucket_key;
    RETURN true;
  END IF;

  IF bucket.request_count >= _max_requests THEN
    UPDATE public.rate_limit_buckets
    SET updated_at = now()
    WHERE bucket_key = _bucket_key;
    RETURN false;
  END IF;

  UPDATE public.rate_limit_buckets
  SET request_count = request_count + 1, updated_at = now()
  WHERE bucket_key = _bucket_key;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;

-- Remove abandoned buckets opportunistically. This is intentionally bounded to
-- old rows so the table cannot grow forever from webhook transaction IDs.
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_buckets()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limit_buckets
  WHERE updated_at < now() - interval '1 day';
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limit_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_buckets() TO service_role;

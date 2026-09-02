ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_cash_paid_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Delivered' AND NEW.payment_method = 'cash' AND NEW.payment_status <> 'paid' THEN
    NEW.payment_status := 'paid';
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_cash_paid ON public.orders;
CREATE TRIGGER trg_mark_cash_paid
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.mark_cash_paid_on_delivery();
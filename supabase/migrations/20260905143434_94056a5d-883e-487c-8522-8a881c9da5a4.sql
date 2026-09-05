DROP POLICY IF EXISTS "Authenticated users can create orders" ON public.orders;
DROP POLICY IF EXISTS "Users can create own order items" ON public.order_items;
REVOKE INSERT ON public.orders FROM authenticated, anon;
REVOKE INSERT ON public.order_items FROM authenticated, anon;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.order_items TO service_role;
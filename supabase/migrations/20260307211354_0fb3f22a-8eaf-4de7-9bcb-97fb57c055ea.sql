
-- Fix orders INSERT to require auth
DROP POLICY "Anyone can create orders" ON public.orders;
CREATE POLICY "Authenticated users can create orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Fix order_items INSERT to require auth
DROP POLICY "Anyone can create order items" ON public.order_items;
CREATE POLICY "Authenticated users can create order items" ON public.order_items
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Keep orders SELECT permissive for admin dashboard (MVP)
DROP POLICY "Users can read own orders" ON public.orders;
CREATE POLICY "Anyone can read orders" ON public.orders
  FOR SELECT USING (true);

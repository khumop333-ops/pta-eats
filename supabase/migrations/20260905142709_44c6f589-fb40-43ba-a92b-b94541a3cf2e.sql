-- restaurants: drop public write policies
DROP POLICY IF EXISTS "Anyone can insert restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Anyone can update restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Anyone can delete restaurants" ON public.restaurants;

CREATE POLICY "Admins can insert restaurants" ON public.restaurants FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update restaurants" ON public.restaurants FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete restaurants" ON public.restaurants FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- menu_items: drop public write policies
DROP POLICY IF EXISTS "Anyone can insert menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Anyone can update menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Anyone can delete menu items" ON public.menu_items;

CREATE POLICY "Admins can insert menu items" ON public.menu_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update menu items" ON public.menu_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete menu items" ON public.menu_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- orders: remove public read/update
DROP POLICY IF EXISTS "Anyone can read orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can update orders" ON public.orders;

CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all orders" ON public.orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Deliverers can view orders" ON public.orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'deliverer'));
CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Deliverers can update orders" ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'deliverer')) WITH CHECK (public.has_role(auth.uid(), 'deliverer'));

-- order_items: remove public read
DROP POLICY IF EXISTS "Anyone can read order items" ON public.order_items;

CREATE POLICY "Users can view own order items" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()));
CREATE POLICY "Admins can view all order items" ON public.order_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Deliverers can view order items" ON public.order_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'deliverer'));

-- order_items insert: only for own orders
DROP POLICY IF EXISTS "Authenticated users can create order items" ON public.order_items;
CREATE POLICY "Users can create own order items" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()));

-- storage: restrict restaurant-images writes
DROP POLICY IF EXISTS "Anyone can upload restaurant images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update restaurant images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete restaurant images" ON storage.objects;

CREATE POLICY "Staff can upload restaurant images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'restaurant-images' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner')));
CREATE POLICY "Staff can update restaurant images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'restaurant-images' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner')))
  WITH CHECK (bucket_id = 'restaurant-images' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner')));
CREATE POLICY "Staff can delete restaurant images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'restaurant-images' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner')));

-- lock down SECURITY DEFINER helper functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.owns_restaurant(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
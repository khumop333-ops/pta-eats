
-- Create restaurants table
CREATE TABLE public.restaurants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cuisine TEXT NOT NULL,
  rating NUMERIC NOT NULL DEFAULT 4.0,
  image_url TEXT NOT NULL DEFAULT '',
  delivery_time TEXT NOT NULL DEFAULT '30-40 min',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create menu_items table
CREATE TABLE public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id INTEGER NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC NOT NULL,
  category TEXT NOT NULL DEFAULT 'Mains',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can read restaurants" ON public.restaurants FOR SELECT USING (true);
CREATE POLICY "Anyone can read menu items" ON public.menu_items FOR SELECT USING (true);

-- Admin write access (using permissive policies - admin auth is handled app-side)
CREATE POLICY "Anyone can insert restaurants" ON public.restaurants FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update restaurants" ON public.restaurants FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete restaurants" ON public.restaurants FOR DELETE USING (true);

CREATE POLICY "Anyone can insert menu items" ON public.menu_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update menu items" ON public.menu_items FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete menu items" ON public.menu_items FOR DELETE USING (true);

-- Updated_at trigger
CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

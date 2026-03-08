
-- Create a public storage bucket for restaurant images
INSERT INTO storage.buckets (id, name, public) VALUES ('restaurant-images', 'restaurant-images', true);

-- Allow anyone to read images
CREATE POLICY "Anyone can view restaurant images" ON storage.objects FOR SELECT USING (bucket_id = 'restaurant-images');

-- Allow anyone to upload images (admin-only in practice via app logic)
CREATE POLICY "Anyone can upload restaurant images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'restaurant-images');

-- Allow anyone to update restaurant images
CREATE POLICY "Anyone can update restaurant images" ON storage.objects FOR UPDATE USING (bucket_id = 'restaurant-images');

-- Allow anyone to delete restaurant images
CREATE POLICY "Anyone can delete restaurant images" ON storage.objects FOR DELETE USING (bucket_id = 'restaurant-images');

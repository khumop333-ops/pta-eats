-- Storage guard rails for the public restaurant-images bucket.
--
-- Migration 20260905142709 restricted writes to admins and restaurant owners, but
-- placed no limit on WHAT they could upload: any file type, at any path, was
-- accepted into a bucket that is served publicly. Client-side checks in
-- RestaurantManager.tsx already reject non-images and files over 5MB, but those
-- are trivially bypassed by calling the storage API directly.
--
-- This keeps the same role gate and adds a server-side content gate, using only
-- columns that are populated on the INSERT row (bucket_id, name, mimetype).

DROP POLICY IF EXISTS "Staff can upload restaurant images" ON storage.objects;

CREATE POLICY "Staff can upload restaurant images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'restaurant-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner'))
    -- Images only. The bucket is public, so it must not become a general file host.
    AND COALESCE(mimetype, '') ~ '^image/(jpeg|png|webp|gif|avif)$'
    -- Block traversal and absolute-ish paths in the object name.
    AND COALESCE(name, '') <> ''
    AND COALESCE(name, '') NOT LIKE '%..%'
    AND COALESCE(name, '') NOT LIKE '/%'
    -- The app writes every image under restaurants/; keep that the only prefix.
    AND COALESCE(name, '') LIKE 'restaurants/%'
  );

-- The existing UPDATE policy lets staff replace an image, which means it must be
-- gated the same way, otherwise an allowed image could be swapped for any file.
DROP POLICY IF EXISTS "Staff can update restaurant images" ON storage.objects;

CREATE POLICY "Staff can update restaurant images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'restaurant-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner'))
  )
  WITH CHECK (
    bucket_id = 'restaurant-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'restaurant_owner'))
    AND COALESCE(mimetype, '') ~ '^image/(jpeg|png|webp|gif|avif)$'
    AND COALESCE(name, '') <> ''
    AND COALESCE(name, '') NOT LIKE '%..%'
    AND COALESCE(name, '') NOT LIKE '/%'
    AND COALESCE(name, '') LIKE 'restaurants/%'
  );

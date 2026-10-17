-- WhatsApp-redirect restaurant directory fields.
-- restaurants.whatsapp_number is nullable. When null, the frontend falls back to the Roma number.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS address_line TEXT,
  ADD COLUMN IF NOT EXISTS suburb TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT;

-- Keep this safe to rerun while preserving any existing non-empty slug values.
-- The normalized restaurant name is used for new slugs; collisions get a numeric suffix.
DO $$
DECLARE
  restaurant RECORD;
  slug_base TEXT;
  candidate_slug TEXT;
  suffix INTEGER;
BEGIN
  FOR restaurant IN
    SELECT id, name, slug
    FROM public.restaurants
    ORDER BY id
  LOOP
    IF restaurant.slug IS NULL OR BTRIM(restaurant.slug) = '' THEN
      slug_base := TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE(TRIM(restaurant.name), '[^a-zA-Z0-9]+', '-', 'g')));
      IF slug_base IS NULL OR slug_base = '' THEN
        slug_base := 'restaurant-' || restaurant.id::TEXT;
      END IF;
      candidate_slug := slug_base;
    ELSE
      slug_base := restaurant.slug;
      candidate_slug := restaurant.slug;
    END IF;

    suffix := 2;
    WHILE EXISTS (
      SELECT 1
      FROM public.restaurants AS other
      WHERE other.slug = candidate_slug
        AND other.id <> restaurant.id
    ) LOOP
      candidate_slug := slug_base || '-' || suffix::TEXT;
      suffix := suffix + 1;
    END LOOP;

    UPDATE public.restaurants
    SET slug = candidate_slug
    WHERE id = restaurant.id
      AND slug IS DISTINCT FROM candidate_slug;
  END LOOP;
END;
$$;

UPDATE public.restaurants
SET is_listed = TRUE
WHERE is_listed IS NULL;

ALTER TABLE public.restaurants
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN is_listed SET DEFAULT TRUE,
  ALTER COLUMN is_listed SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_slug_key
  ON public.restaurants (slug);

-- restaurants has no deleted_at column in the current schema, so this is a plain index.
CREATE INDEX IF NOT EXISTS restaurants_listed_idx
  ON public.restaurants (is_listed);

COMMENT ON COLUMN public.restaurants.whatsapp_number IS
  'When null, the frontend falls back to the Roma number.';

-- Public menu pages order by this field; images are optional.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

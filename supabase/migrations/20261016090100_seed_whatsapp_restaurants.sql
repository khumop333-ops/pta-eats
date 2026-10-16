-- Seed restaurants for WhatsApp-redirect launch. Replace placeholder address and add menu items via the admin dashboard.

INSERT INTO public.restaurants (
  name,
  slug,
  cuisine,
  address_line,
  city,
  province,
  suburb
)
VALUES
  (
    'Magwinya Zone',
    'magwinya-zone',
    'Local favourites (update in admin)',
    'Pretoria Central (update in admin)',
    'Pretoria',
    'Gauteng',
    'Pretoria Central'
  ),
  (
    'Sheamus',
    'sheamus',
    'Local favourites (update in admin)',
    'Pretoria Central (update in admin)',
    'Pretoria',
    'Gauteng',
    'Pretoria Central'
  ),
  (
    'Thuba Rush',
    'thuba-rush',
    'Local favourites (update in admin)',
    'Pretoria Central (update in admin)',
    'Pretoria',
    'Gauteng',
    'Pretoria Central'
  )
ON CONFLICT (slug) DO NOTHING;

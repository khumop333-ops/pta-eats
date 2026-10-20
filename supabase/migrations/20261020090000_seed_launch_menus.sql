-- Launch menus (owner-supplied, 19–20 Oct 2026) for Magwinya Zone and Thuba Rush,
-- plus the new restaurant Ko Kgorong. Sheamus: menu still pending.
--
-- Source: menu PDF (Magwinya Zone) and menu photos/flyers (Thuba Rush, Ko Kgorong)
-- sent by the owner. Prices are exactly as printed by each restaurant; create-order
-- re-prices every order from these rows, so this file IS the price list.
--
-- Safe to re-run (forward-only, idempotent):
--   * restaurant details only replace seed placeholders / NULLs — never admin edits;
--   * Ko Kgorong is inserted ON CONFLICT (slug) DO NOTHING;
--   * a menu item is skipped if that restaurant already has an item with the same name.
--
-- Deliberately NOT loaded (needs owner confirmation):
--   * Thuba Rush "10 Full Wings & Chips" — printed as R250, but 10 wings alone are R110
--     and 6 wings & chips are R85, so R250 looks like a typo.

-- ---------------------------------------------------------------------------
-- 1. Restaurant details (placeholders only)
-- ---------------------------------------------------------------------------

UPDATE public.restaurants
SET description = 'Freshly fried magwinya, sweet treats, hot and cold drinks.'
WHERE slug = 'magwinya-zone'
  AND (description IS NULL OR btrim(description) = '');

UPDATE public.restaurants
SET cuisine = 'Kotas, dagwoods & wings'
WHERE slug = 'thuba-rush'
  AND cuisine = 'Local favourites (update in admin)';

UPDATE public.restaurants
SET description = 'Home of the private school kota — kotas, dagwoods, wings, platters and pap plates.'
WHERE slug = 'thuba-rush'
  AND (description IS NULL OR btrim(description) = '');

-- New restaurant. Unlisted until the owner has approved their page at
-- roma.africa/r/ko-kgorong and a real address is captured (MENU_INTAKE_TEMPLATE
-- checklist) — then switch "listed" on in /admin.
INSERT INTO public.restaurants (
  name, slug, cuisine, description, address_line, suburb, city, province, is_listed
)
VALUES (
  'Ko Kgorong',
  'ko-kgorong',
  'Chicken, beef & wors plates',
  'Daily plates — chicken, beef, wors or a mix of meats.',
  'Pretoria Central (update in admin)',
  'Pretoria Central',
  'Pretoria',
  'Gauteng',
  FALSE
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Menu items
--    sort_order controls item order AND category order on /r/:slug
--    (categories appear in order of their first item).
-- ---------------------------------------------------------------------------

WITH menu (slug, sort_order, category, name, description, price) AS (
  VALUES
  -- ===================== Magwinya Zone =====================
  ('magwinya-zone', 10,  'Magwinya & Treats', 'Magwinya Plain',                     'Classic magwinya (fat cake).', 2.50),
  ('magwinya-zone', 20,  'Magwinya & Treats', 'Magwinya Flatties',                  '', 3.00),
  ('magwinya-zone', 30,  'Magwinya & Treats', 'Cinnamon Frosties (4)',              '', 15.00),
  ('magwinya-zone', 40,  'Magwinya & Treats', 'Chocolate Bursts (4) — Bar One',     '', 25.00),
  ('magwinya-zone', 50,  'Magwinya & Treats', 'Chocolate Burst Single — Bar One',   '', 7.50),

  ('magwinya-zone', 110, 'Cold Drinks', 'Cold Drink 300ml',            '', 10.00),
  ('magwinya-zone', 120, 'Cold Drinks', 'Buddy''s Cold Drink 440ml',   '', 15.00),
  ('magwinya-zone', 130, 'Cold Drinks', 'Switch 500ml',                '', 10.00),
  ('magwinya-zone', 140, 'Cold Drinks', 'Dragon Original 500ml',       '', 10.00),
  ('magwinya-zone', 150, 'Cold Drinks', 'Red Bull Original 250ml',     '', 20.00),
  ('magwinya-zone', 160, 'Cold Drinks', 'Liqui-Fruit 200ml',           '', 11.00),
  ('magwinya-zone', 170, 'Cold Drinks', 'Rio Fruit Juice Blend',       '', 15.00),
  ('magwinya-zone', 180, 'Cold Drinks', 'Pepsi Can 500ml',             '', 11.00),
  ('magwinya-zone', 190, 'Cold Drinks', 'Bon Sante Still Water',       '', 10.00),

  ('magwinya-zone', 210, 'Hot Drinks', 'Instant Coffee',                     '', 8.50),
  ('magwinya-zone', 220, 'Hot Drinks', 'Tea',                                '', 7.50),
  ('magwinya-zone', 230, 'Hot Drinks', 'Rooibos',                            '', 7.50),
  ('magwinya-zone', 240, 'Hot Drinks', 'Hug in a Mug Creamy Cappuccino',     '', 15.00),
  ('magwinya-zone', 250, 'Hot Drinks', 'Nestlé Hot Chocolate',               '', 15.00),

  ('magwinya-zone', 310, 'Spreads', 'Apricot Jam Sachet 18g',       '', 2.00),
  ('magwinya-zone', 320, 'Spreads', 'Mixed Fruit Jam Sachet 18g',   '', 2.00),
  ('magwinya-zone', 330, 'Spreads', 'Chocolate Sachet 18g',         '', 5.00),
  ('magwinya-zone', 340, 'Spreads', 'Peanut Butter Sachet 18g',     '', 2.50),
  ('magwinya-zone', 350, 'Spreads', 'Honey Sachet 8g',              '', 2.50),

  ('magwinya-zone', 410, 'Fillings & Extras', 'Atchaar 80g',                   '', 6.50),
  ('magwinya-zone', 420, 'Fillings & Extras', 'Atchaar Hot 80g',               '', 6.50),
  ('magwinya-zone', 430, 'Fillings & Extras', 'Atchaar Veg 80g',               '', 6.50),
  ('magwinya-zone', 440, 'Fillings & Extras', 'Cheese Slice',                  '', 3.00),
  ('magwinya-zone', 450, 'Fillings & Extras', 'French Polony 80g (pork)',      '', 7.50),
  ('magwinya-zone', 460, 'Fillings & Extras', 'French Polony 80g (no pork)',   '', 7.50),

  -- ===================== Thuba Rush =====================
  -- Kotas (newest kota flyer; all topped & based with signature sauces:
  -- creamy white, prego, burger, BBQ)
  ('thuba-rush', 10, 'Kotas', 'Thuba 1 Kota',
    'Russian, cheese, fries, lettuce, cherry peppers. Topped and based with signature sauces.', 35.00),
  ('thuba-rush', 20, 'Kotas', 'Thuba 2 Kota',
    'Beef patty or grilled chicken patty, cheese, fries, lettuce, cherry peppers. Topped and based with signature sauces.', 40.00),
  ('thuba-rush', 30, 'Kotas', 'Thuba 3 Kota',
    'Creamy prego chicken livers or wors, cheese, fries, lettuce, cherry peppers. Topped and based with signature sauces.', 45.00),
  ('thuba-rush', 40, 'Kotas', 'Thuba 4 Kota',
    'Hake / fish fillet, cheese, fries, lettuce, cherry peppers. Topped and based with signature sauces.', 55.00),
  ('thuba-rush', 50, 'Kotas', 'Thuba 5 Kota',
    'Russian and beef patty or grilled chicken patty, cheese, fries, cherry peppers. Topped and based with signature sauces.', 60.00),
  ('thuba-rush', 60, 'Kotas', 'Thuba 6 Kota (whole loaf)',
    'Whole loaf stacked with sliced Russians, beef patty, chicken fillet, eggs, cheese, extra mozzarella, lettuce, cherry peppers, fries and wors.', 155.00),
  ('thuba-rush', 70, 'Kotas', 'Thuba 7 Kota (whole loaf)',
    'Whole loaf stacked with 2x sliced Russians, 2x large beef patties, 2x creamed chicken fillets, wors, 2x cheese, extra mozzarella, fries, lettuce and cherry peppers. Topped with signature sauces.', 250.00),

  -- Dagwoods
  ('thuba-rush', 110, 'Dagwoods', 'Thuba 1 Dagwood',
    'Creamy fillet, diced Russian, cheese, lettuce and fries.', 60.00),
  ('thuba-rush', 120, 'Dagwoods', 'Thuba 2 Dagwood',
    'Creamy fillet / beef patty, diced Russian, cheese, egg, lettuce and fries.', 75.00),
  ('thuba-rush', 130, 'Dagwoods', 'Thuba 3 Dagwood',
    'Diced Russian, creamy chicken fillet, beef patty, cheese, egg, lettuce and fries.', 100.00),

  -- Burgers & platters
  ('thuba-rush', 210, 'Burgers & Platters', 'Burger Ultimate',
    'Beef patty, creamy onion, cheese, lettuce and fries.', 55.00),
  ('thuba-rush', 220, 'Burgers & Platters', 'Platter for 2',
    'Dagwood, wings / ribs and fries.', 120.00),
  ('thuba-rush', 230, 'Burgers & Platters', 'Platter for 4',
    'Dagwood, ribs and chicken, cheesy balls, 6 wings and fries.', 250.00),
  ('thuba-rush', 240, 'Burgers & Platters', 'Platter for 6',
    'Dagwood, 2 burgers, wings, ribs and fries.', 320.00),

  -- Wings (flavour goes in the order notes)
  ('thuba-rush', 310, 'Wings', '2 Full Wings',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 30.00),
  ('thuba-rush', 320, 'Wings', '4 Full Wings',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 45.00),
  ('thuba-rush', 330, 'Wings', '6 Full Wings',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 70.00),
  ('thuba-rush', 340, 'Wings', '10 Full Wings',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 110.00),
  ('thuba-rush', 350, 'Wings', '2 Full Wings & Chips',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 45.00),
  ('thuba-rush', 360, 'Wings', '4 Full Wings & Chips',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 65.00),
  ('thuba-rush', 370, 'Wings', '6 Full Wings & Chips',
    'Flavours: BBQ, Prego, Peri Peri, Hot Peri Peri, Mild or Lemon & Herb.', 85.00),
  -- '10 Full Wings & Chips' intentionally omitted — see header.

  -- Pap plates
  ('thuba-rush', 410, 'Pap Plates', 'Pap, ¼ Chicken & 2 Sides',            '', 55.00),
  ('thuba-rush', 420, 'Pap Plates', 'Pap, ½ Chicken & 2 Sides',            '', 75.00),
  ('thuba-rush', 430, 'Pap Plates', 'Pap, Full Chicken & 2 Sides',         '', 140.00),
  ('thuba-rush', 440, 'Pap Plates', 'Pap, Steak & 2 Sides',                '', 60.00),
  ('thuba-rush', 450, 'Pap Plates', 'Pap, Steak, Chicken & 2 Sides',       '', 80.00),
  ('thuba-rush', 460, 'Pap Plates', 'Pap, Steak, Chicken, Wors & 2 Sides', '', 105.00),

  -- Add-ons
  ('thuba-rush', 510, 'Add-ons', 'Extra Egg',    '', 5.00),
  ('thuba-rush', 520, 'Add-ons', 'Extra Cheese', '', 5.00),
  ('thuba-rush', 530, 'Add-ons', 'Extra Sauce',  '', 5.00),

  -- ===================== Ko Kgorong (daily menu) =====================
  ('ko-kgorong', 10,  'Chicken', 'Chicken — Single Plate', '', 50.00),
  ('ko-kgorong', 20,  'Chicken', 'Chicken — Double',       '', 80.00),
  ('ko-kgorong', 110, 'Beef',    'Beef — Single',          '', 60.00),
  ('ko-kgorong', 120, 'Beef',    'Beef — Double',          '', 90.00),
  ('ko-kgorong', 210, 'Wors',    'Wors — Single',          '', 50.00),
  ('ko-kgorong', 220, 'Wors',    'Wors — Double',          '', 80.00),
  ('ko-kgorong', 310, 'Mix',     'Mix — Single Plate',     '', 70.00),
  ('ko-kgorong', 320, 'Mix',     'Mix — Double',           '', 100.00),
  ('ko-kgorong', 330, 'Mix',     'Mix — Triple',           '', 140.00),
  ('ko-kgorong', 340, 'Mix',     'Mix — Four Meat',        '', 190.00)
)
INSERT INTO public.menu_items (restaurant_id, name, description, price, category, sort_order)
SELECT r.id, m.name, m.description, m.price, m.category, m.sort_order
FROM menu AS m
JOIN public.restaurants AS r ON r.slug = m.slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.menu_items AS existing
  WHERE existing.restaurant_id = r.id
    AND lower(existing.name) = lower(m.name)
);

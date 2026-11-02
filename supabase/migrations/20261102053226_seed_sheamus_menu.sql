-- Sheamus menu, transcribed from the two owner-supplied menu photos on 2 Nov 2026.
-- Sources: IMG_20260826_143822.jpg (23 plate items) and
-- IMG_20260826_143826.jpg (10 numbered spathlos + handwritten 2 Viennas addition).
-- See docs/SHEAMUS_MENU.md for the transcription and provenance notes.
--
-- Forward-only and safe to re-run: existing items (matched case-insensitively
-- by name within Sheamus) are never overwritten, including admin price edits.
-- Restaurant copy only replaces the original placeholder / an empty description.
-- Address, contact details, images and listing status are intentionally unchanged.

UPDATE public.restaurants
SET cuisine = 'Spathlo, plates & chicken'
WHERE slug = 'sheamus'
  AND cuisine = 'Local favourites (update in admin)';

UPDATE public.restaurants
SET description = 'Spathlo with chips and achaar, plus pap or rice plates, chicken and chips.'
WHERE slug = 'sheamus'
  AND (description IS NULL OR btrim(description) = '');

-- sort_order preserves the plate-menu order, followed by the spathlo menu.
-- The public page groups categories by their first item's sort_order.
WITH menu (sort_order, category, name, description, price) AS (
  VALUES
    -- MENU FOR PLATE: all 23 printed items, in source order.
    (10,  'Plates', 'Pap & Beef',                         '', 75.00),
    (20,  'Plates', 'Pap & Cow Head',                     '', 75.00),
    (30,  'Plates', 'Pap & Mogodu',                       '', 75.00),
    (40,  'Plates', 'Rice & Beef',                        '', 75.00),
    (50,  'Plates', 'Pap/Rice & 3-Piece Chicken',         '', 55.00),
    (60,  'Plates', 'Pap/Rice & 4-Piece Chicken',         '', 60.00),
    (70,  'Plates', 'Pap/Rice & Half Chicken',            '', 75.00),
    (80,  'Plates', 'Pap/Rice & Chicken Gizzards',        '', 50.00),
    (90,  'Plates', 'Pap/Rice & Chicken Liver',           '', 50.00),
    (100, 'Plates', 'Pap/Rice & Quarter Chicken',         '', 55.00),
    (110, 'Plates', 'Pap/Rice & Steak',                   '', 75.00),
    (120, 'Plates', 'Pap/Rice & Maotwana',                '', 50.00),
    (130, 'Plates', 'Steak & 2 Salads',                   '', 60.00),
    (140, 'Plates', 'Steak & Chips',                      '', 75.00),
    (150, 'Plates', 'Quarter Chicken & Chips',            '', 55.00),
    (160, 'Plates', 'Half Chicken & Chips',               '', 75.00),
    (170, 'Plates', '3 Wings & Chips',                    '', 55.00),
    (180, 'Plates', '4 Wings & Chips',                    '', 60.00),
    (190, 'Plates', 'Half Chicken Only',                  '', 70.00),
    (200, 'Plates', 'Full Chicken & Large Chips',         '', 150.00),
    (210, 'Plates', 'Full Chicken & Medium Chips',        '', 140.00),
    (220, 'Plates', 'Full Chicken & Small Chips',         '', 130.00),
    (230, 'Plates', 'Full Chicken Only',                  '', 120.00),

    -- SPATHLO MENU: retain the printed numbers to make orders easy to match.
    (310, 'Spathlo', 'Spathlo 1 — Chips & Achaar',         '', 20.00),
    (320, 'Spathlo', 'Spathlo 2 — Chips, Achaar & Polony', '', 22.00),
    (330, 'Spathlo', 'Spathlo 3 — Chips, Achaar, Polony & Cheese', '', 25.00),
    (340, 'Spathlo', 'Spathlo 4 — Chips, Achaar, Polony & Egg', '', 26.00),
    (350, 'Spathlo', 'Spathlo 5 — Chips, Achaar, Polony, Cheese & Egg', '', 28.00),
    (360, 'Spathlo', 'Spathlo 6 — Chips, Achaar, Polony & Vienna', '', 27.00),
    (370, 'Spathlo', 'Spathlo 7 — Chips, Achaar, Polony & Small Russian', '', 30.00),
    (380, 'Spathlo', 'Spathlo 8 — Chips, Achaar, Polony, Cheese, Egg & Small Russian', '', 37.00),
    (390, 'Spathlo', 'Spathlo 9 — Chips, Achaar, Polony, Cheese & Egg', '', 38.00),
    (400, 'Spathlo', 'Spathlo 10 — Chips, Achaar, Polony, Cheese, Egg & Beef/Chicken Patty', '', 45.00),
    (410, 'Spathlo', 'Spathlo — 2 Viennas',
      'Chips, achaar and polony with 2 Viennas. Handwritten addition beside item 9.', 37.00)
)
INSERT INTO public.menu_items (restaurant_id, name, description, price, category, sort_order)
SELECT r.id, m.name, m.description, m.price, m.category, m.sort_order
FROM menu AS m
JOIN public.restaurants AS r ON r.slug = 'sheamus'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.menu_items AS existing
  WHERE existing.restaurant_id = r.id
    AND lower(existing.name) = lower(m.name)
);

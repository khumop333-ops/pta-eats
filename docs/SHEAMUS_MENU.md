# Sheamus — menu intake

Transcribed on **2 November 2026** from the two menu photographs supplied by the owner.

- `IMG_20260826_143822.jpg`: **MENU FOR PLATE**, 23 items.
- `IMG_20260826_143826.jpg`: **SPATHLO MENU**, 10 numbered items and one handwritten addition.
- Migration: `supabase/migrations/20261102053226_seed_sheamus_menu.sql`, applied to the connected Roma Supabase project on 2 November 2026.
- Verified live: 34 items, 23 Plates and 11 Spathlo, with no duplicate names. Replay checks also confirm that existing admin edits are preserved.
- Customer page: `/r/sheamus`. The same database rows populate the existing admin/owner menu editor; there is no separate hardcoded menu to maintain.

## Plates

| Item | Price |
|---|---:|
| Pap & Beef | R75.00 |
| Pap & Cow Head | R75.00 |
| Pap & Mogodu | R75.00 |
| Rice & Beef | R75.00 |
| Pap/Rice & 3-Piece Chicken | R55.00 |
| Pap/Rice & 4-Piece Chicken | R60.00 |
| Pap/Rice & Half Chicken | R75.00 |
| Pap/Rice & Chicken Gizzards | R50.00 |
| Pap/Rice & Chicken Liver | R50.00 |
| Pap/Rice & Quarter Chicken | R55.00 |
| Pap/Rice & Steak | R75.00 |
| Pap/Rice & Maotwana | R50.00 |
| Steak & 2 Salads | R60.00 |
| Steak & Chips | R75.00 |
| Quarter Chicken & Chips | R55.00 |
| Half Chicken & Chips | R75.00 |
| 3 Wings & Chips | R55.00 |
| 4 Wings & Chips | R60.00 |
| Half Chicken Only | R70.00 |
| Full Chicken & Large Chips | R150.00 |
| Full Chicken & Medium Chips | R140.00 |
| Full Chicken & Small Chips | R130.00 |
| Full Chicken Only | R120.00 |

## Spathlo

The printed numbers are retained in item names so WhatsApp orders can be matched to the restaurant's menu.

| Item | Price |
|---|---:|
| 1 — Chips & achaar | R20.00 |
| 2 — Chips, achaar & polony | R22.00 |
| 3 — Chips, achaar, polony & cheese | R25.00 |
| 4 — Chips, achaar, polony & egg | R26.00 |
| 5 — Chips, achaar, polony, cheese & egg | R28.00 |
| 6 — Chips, achaar, polony & Vienna | R27.00 |
| 7 — Chips, achaar, polony & small Russian | R30.00 |
| 8 — Chips, achaar, polony, cheese, egg & small Russian | R37.00 |
| 9 — Chips, achaar, polony, cheese & egg | R38.00 |
| 10 — Chips, achaar, polony, cheese, egg & beef/chicken patty | R45.00 |
| Handwritten addition — 2 Viennas | R37.00 |

## Transcription notes

- Capitalisation, spacing and obvious spelling errors were normalised (for example, “CAW HEAD” → “Cow Head”, “HAIF” → “Half”, “GIZZAD” → “Gizzards”, and “CHESSE” → “Cheese”). No prices were changed.
- Steak & 2 Salads is printed as `R60.0` and stored as R60.00.
- The handwritten label beside spathlo 9 reads **“2 Vienna R37”**. It is included as **Spathlo — 2 Viennas**, described as chips, achaar and polony with 2 Viennas. Printed item 9 remains a separate R38 item.
- Item 10 offers a **beef/chicken patty** as one menu line, not two separately priced items. Customers can specify their choice in the order notes.
- The migration only replaces placeholder cuisine/empty description copy and skips existing menu names. It does not overwrite admin edits, change listing status, or invent an address, phone number or food photograph.
- Still outstanding from the original intake: a confirmed street address and a restaurant/food cover photo.

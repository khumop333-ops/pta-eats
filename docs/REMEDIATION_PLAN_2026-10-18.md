# Roma — Remediation Plan: best solution for every audit finding

**Date:** 18 October 2026 · **Companion to:** `docs/SITE_AUDIT_2026-10-18.md`
**Principle:** fix in dependency order — config/data first (free, immediate), then the customer flow, then the status engine, then scale/polish. Do not batch runbook phases.

---

## 0. The one big decision first: ONE ordering flow

Everything else gets easier once this is decided.

**Recommended: merge the two flows into one page, one cart, three ways to pay.**

- `/r/:slug` becomes **the** restaurant page (it's the newer, better, shareable one — WhatsApp links, QR codes and Google all point here).
- It gets the cart: menu items get **Add** buttons → cart drawer (reuse `CartSidebar` + `CartContext`).
- Checkout offers three fulfilment/payment choices on one screen:
  1. **Order via WhatsApp** — sends the built cart as a formatted `wa.me` message (the items support already exists unused in `src/lib/whatsapp.ts`). Zero cost, zero account needed, matches how Pretoria Central customers already behave.
  2. **Pay by card** — current `create-order` → iKhokha path, unchanged.
  3. **Cash on delivery** — current cash path, unchanged.
- `/restaurant/:id` becomes a **301-style client redirect** to `/r/:slug` (look up slug by id, `<Navigate replace>`) so old links never break. Homepage cards link to `/r/:slug` too.
- Retire the duplicate `Restaurant`/`MenuItem` types in `src/data/restaurants.ts` in favour of the generated Supabase types, so there's one data model.

**Why not WhatsApp-only?** Card + cash checkout already works and is secure; WhatsApp-only throws that away and makes orders untrackable. **Why not checkout-only?** It forces account creation before a first order — the biggest drop-off point for a local launch, and ignores the WhatsApp behaviour the directory was built for. The hybrid keeps both, with WhatsApp as the low-friction default for guests and checkout for signed-in customers.

**Guest checkout note:** WhatsApp ordering needs no login. Keep card/cash behind login for now (orders are tied to `user_id` everywhere), but put the sign-in wall *after* cart-building, not before browsing.

---

## 1. TODAY — config & data fixes (no code, ~1 hour, fixes P0-2 & F-3)

These are the highest value-per-minute items in the whole audit. Do them before any code.

| # | Fix | Exactly how | Done when |
|---|---|---|---|
| 1.1 | Set the Roma WhatsApp number | Vercel → Project → Settings → Environment Variables → `VITE_ROMA_WHATSAPP_NUMBER` = Roma's number, digits only, no `+` (e.g. `2783…`), Production + Preview. Redeploy. Also add to local `.env`. | Clicking "Order on WhatsApp" on a restaurant with no own number opens WhatsApp to Roma. |
| 1.2 | Give every restaurant its own number | `/admin` → Restaurants → set `whatsapp_number` per restaurant (restaurant's own number if they take orders directly, else Roma's). | `select name, whatsapp_number from restaurants where whatsapp_number is null;` returns 0 rows. |
| 1.3 | Capture real menus & addresses | `/admin` → replace `Local favourites (update in admin)` / `Pretoria Central (update in admin)` placeholders; add menu items for Magwinya Zone, Sheamus, Thuba Rush. | Each listed restaurant has ≥5 menu items, a real address, a cover image. |
| 1.4 | Verify iKhokha secrets | Supabase Dashboard → Edge Functions → Secrets: `IKHOKHA_APP_ID`, `IKHOKHA_APP_SECRET`, `IKHOKHA_MODE=live`. Then place one real low-value card order on prod and confirm the webhook flips it to `paid`. | One real order with `payment_status='paid'`, `paid_at` set, via webhook (not manually). |
| 1.5 | Reconcile DB drift | Run the §9 queries in `docs/DATABASE_STATE.md` in the Supabase SQL editor; compare against the migration chain. | Any drift is either migrated or explained. |

**Also add a guard so this can never silently break again:** in admin, show a red "not orderable" badge on any restaurant missing a WhatsApp number, menu items, or with `is_listed=false` — and (see 2.5) never list incomplete restaurants publicly.

---

## 2. THIS WEEK — the customer flow sprint (fixes P0-1, 3, 4, 5, 7, F-4, F-8)

Ordered by dependency. Roughly 1–2 focused days total.

### 2.1 Merge the flows (P0-1) — ~half a day
- Add Add-to-cart + cart drawer to `PublicRestaurantPage.tsx` (cart context already exists; items need `restaurantId`, already on the row).
- "Order on WhatsApp" button builds the message **from the cart** (`buildWhatsAppLink({ items })` — currently never called with items) and fires the existing `whatsapp_click` analytics event, enriched with item count + cart value.
- `/restaurant/:id` → redirect component to `/r/:slug`. Homepage `FeaturedRestaurants` links to `/r/:slug` (add `slug` to the homepage query/type).
- Delete the now-dead code path in `src/data/restaurants.ts` once nothing imports it (keep `fetchRestaurants` only if the homepage still needs it — repoint it at the directory query).

### 2.2 Fix the checkout auth bounce (P0-3) — ~15 minutes
In `Checkout.tsx`, use the `loading` flag that `AuthContext` already exposes and don't redirect until it resolves:

```tsx
const { user, profile, loading: authLoading } = useAuth();
useEffect(() => {
  if (!authLoading && !user) navigate("/auth", { state: { from: "/checkout" } });
}, [user, authLoading, navigate]);
```

And in `AuthPage`, after sign-in return to `location.state.from` instead of always `/`. This also fixes the same latent race anywhere else `user` is read without `loading`.

### 2.3 Persist the cart + one-restaurant rule (P0-4) — ~1 hour
- Persist `CartContext` to `localStorage` (key `roma-cart-v1`, store items + a saved-at timestamp; ignore entries older than 24h so stale prices never survive a day — prices are re-validated server-side anyway).
- On `addItem`, if the cart is non-empty and `item.restaurantId` differs: toast with action — *"Your cart has items from {X}. Start a new cart?"* [Start new cart] [Keep cart]. Never silently mix.
- Show the restaurant name in the cart drawer so the customer always knows whose food this is.

### 2.4 Quarantine the demo fallback (P0-5) — ~30 minutes
- Gate `fallbackRestaurants` behind `import.meta.env.DEV` **only**. In production, an empty/failed fetch shows an honest "Restaurants are being loaded / Roma is onboarding restaurants — check back soon" state (the directory page already has this copy — reuse it).
- Why: the fallback currently (a) can't complete an order (non-UUID IDs fail `create-order` validation) and (b) hides real outages behind a healthy-looking homepage. A visible empty state is better than a broken order.

### 2.5 One listing rule everywhere (F-4) — ~15 minutes
- Homepage query gets the same `.eq("is_listed", true)` filter as `/r`, plus a completeness rule: listed **and** has a WhatsApp number **and** ≥1 menu item. Simplest robust version: enforce completeness when an admin toggles `is_listed` on (validate in `RestaurantManager`, refuse with a message listing what's missing), and keep the `is_listed` filter in both queries.

### 2.6 Make the hero search real (P0-7) — ~1 hour
- Phase 1 (now): client-side. The homepage already loads restaurants + menus — wire the input to filter and show a dropdown of matching restaurants/dishes linking to `/r/:slug`. No backend change.
- Phase 2 (only if search volume justifies it): Postgres full-text search (`tsvector` on restaurant name/cuisine + menu item name) via an RPC. Don't build this pre-emptively.

### 2.7 Fix the share image (F-8) — ~15 minutes
- Create `public/og-image.jpg` (1200×630, use the hero food photo + Roma logo). This is the image WhatsApp/Facebook show when anyone shares a roma.africa link — for this business that's a marketing asset, not a nicety.
- Add a real `sitemap.xml` (static file listing `/`, `/r`, and each `/r/:slug` — regenerate on deploy or just list the handful of launch restaurants) and confirm `robots.txt` allows indexing.

**Sprint acceptance test:** on a phone, from a cold start: open a shared `/r/:slug` link → add 3 items → (a) order via WhatsApp and receive a correctly itemised message, (b) sign in and pay by card, (c) refresh mid-checkout and stay logged in with cart intact. All three must pass.

---

## 3. NEXT — the order-status engine (fixes P0-6; Runbook Phase 3, amended)

This is the biggest remaining structural flaw and the runbook already plans it — with one amendment worth making before you start:

**Amendment to the runbook:** Appendix D's canonical list (`pending_payment, paid, preparing, …`) conflates *payment* state with *fulfilment* state in one column. You already have a separate `payment_status` column — use it. Recommended final model:

| Column | Values |
|---|---|
| `orders.status` (fulfilment) | `placed → preparing → ready_for_pickup → picked_up → delivered`, plus `cancelled` (terminal, reachable from any non-delivered state) |
| `orders.payment_status` | `pending`, `paid`, `failed`, `cash_due`, `refunded` |

Map legacy strings: `New→placed`, `Accepted→preparing`, `Ready`/`Ready for Pickup/Delivery→ready_for_pickup`, `Picked Up→picked_up`, `On the Way→picked_up` (or add `on_the_way` if drivers genuinely distinguish carrying vs in-transit — decide once, with the drivers).

**Best implementation path (mostly the runbook's, in its order):**
1. **3.1** One shared `STATUS` constant + label/colour map in `src/lib/orderStatus.ts`, imported by all three dashboards — kills the vocabulary drift in the UI immediately, before any DB change.
2. **3.2** Constrain writes: each dashboard only offers the transitions legal *for its role* (owner: placed→preparing→ready_for_pickup, cancel; driver: ready_for_pickup→picked_up→delivered; admin: everything incl. cancel).
3. **3.3** Backfill existing rows to canonical strings (empty-DB finding from Phase 0.2 makes this near-zero-risk — re-confirm row count first).
4. **3.4** Convert the column to a Postgres `enum` type + a `BEFORE UPDATE` transition trigger that rejects illegal jumps (e.g. delivered→preparing). Trigger, not just app code — the dashboards write via PostgREST, so the DB is the only enforcement point every writer shares.
5. **3.5** Add the missing **Cancel order** action (admin + owner, with a reason prompt stored in a new `cancellation_reason` column) and align the cash trigger (`mark_cash_paid_on_delivery`) to fire on `delivered`.
6. **Tests (runbook requires these before prod):** the Appendix A RLS/transition matrix as SQL assertions in the existing migration CI.

**Effort:** ~1 day including tests. **Payoff:** every dashboard, the customer tracking view, and any future notification logic finally speak one language.

---

## 4. THEN — money, notifications & trust (fixes F-1, F-2, F-6, F-7 + Runbook 2/4/5)

### 4.1 Notifications (F-1) — phased, cheapest first
- **Phase A (same day, zero cost):** prefilled WhatsApp deep-link buttons where humans already are — on each admin/owner order card: *"📲 Notify customer"* (`wa.me/{customer_phone}?text=Your Roma order from X is on its way…`), and on admin: *"Notify restaurant"* / *"Notify driver {name}"*. Humans tap, WhatsApp sends. No API, no cost, works today.
- **Phase B (when order volume makes manual tapping painful):** automated sends via the **WhatsApp Business Cloud API (Meta)** — template messages (`order_confirmed`, `order_out_for_delivery`) triggered from an `order_notifications` outbox table written by a trigger on `orders`, drained by a scheduled Edge Function. Choose Cloud API over Twilio (same WhatsApp, materially cheaper per conversation, one less vendor). Add SMS (via a local provider) only as fallback for non-WhatsApp numbers, and email via Resend for receipts. **Do not build Phase B pre-launch** — build the outbox table shape now if convenient, send manually until volume hurts.

### 4.2 Payment retry (F-2) — ~1 hour
`create-ikhokha-payment` already does everything needed (ownership check, already-paid guard). Just call it again: add **"Pay now"** buttons on the confirmation page (failed state) and on unpaid card orders in My Orders. Also: unpaid `pending` card orders older than ~24h should be auto-cancelled by a scheduled function so they don't clutter dashboards forever.

### 4.3 Accounts basics (F-6) — ~half a day
- "Forgot password?" on all four login screens → `supabase.auth.resetPasswordForEmail` + a `/reset-password` page handling the recovery link. (One shared component — the four screens currently duplicate this UI.)
- Profile page (or My Orders header section): edit full name + phone, saved to `profiles`. Checkout then saves edited phone/address details back to the profile on order placement ("Save for next time" — default on), so repeat customers stop retyping.

### 4.4 Real delivery rules (F-7) — small now, bigger later
- **Now:** move `DELIVERY_FEE` into one shared constant imported by checkout *and* injected into the Edge Function via env (`DELIVERY_FEE_CENTS`), so client and server can't drift. Validate phone format (`^(\+27|0)\d{9}$`) in both the form and the `create-order` Zod schema — drivers currently get unusable numbers.
- **At launch-area expansion:** a `delivery_zones` table (suburb list + fee + min order per zone), address suburb matched at checkout; restaurant `opening_hours` + an `is_open` override switch honoured on the public page ("Closed — opens 09:00", ordering disabled). Build the zone table when you expand beyond Pretoria Central, not before.

### 4.5 Runbook Phases 2, 4, 5 — as written, in order
- **Phase 2** (FK on `restaurant_id` with `on delete restrict` + `restaurants.deleted_at` soft-delete + dashboard `deleted_at is null` filters + filter-column indexes): ~half a day, do with the status work since both touch dashboards.
- **Phase 4** (integer cents): the DB is pre-/early-launch, so do the simple one-shot conversion the runbook's Phase 0.2 note allows, rather than full expand/contract. Rename-at-the-boundary: convert `price`/`total` etc. to `*_cents int`, format only in the UI (`(cents/100).toFixed(2)` — `whatsapp.ts` already thinks in cents).
- **Phase 5** (verify only `service_role`/webhook can flip `payment_status`): mostly an audit + the Phase 1 trigger may already cover it — verify with the runbook's grep + one RLS test per role.

---

## 5. Platform hardening (fixes F-5, F-9, F-10, F-11 + performance)

| # | Fix | Best way | Effort |
|---|---|---|---|
| 5.1 | N+1 queries (F-5) | Replace per-order `order_items` fetches with a single join: `.select("*, order_items(*)")` in Admin/Owner/Deliverer/MyOrders. Add keyset pagination to admin (`created_at` cursor, 50/page). | ~1 hour |
| 5.2 | 696 kB bundle | `React.lazy` + `Suspense` on the four dashboard/login route groups in `App.tsx`; customers stop downloading admin code. Expect the initial chunk to drop by roughly a third. Also lazy-load below-the-fold homepage sections later if needed. | ~1 hour |
| 5.3 | Lint red (F-10) | Exclude vendored `src/components/ui/**` from ESLint (it's generated shadcn code) — or fix the 2 empty-interface errors and add eslint-disable headers. Then make lint a merge gate. | 15 min |
| 5.4 | No frontend CI (F-9) | One GitHub Actions workflow on every PR: `npm ci → tsc --noEmit → vitest → vite build`. Keep the existing Supabase migration CI as-is. | 30 min |
| 5.5 | Test coverage (F-9) | Highest-value tests first, in this order: (1) `buildWhatsAppLink` (items, totals, missing number), (2) cart rules (single-restaurant, persistence), (3) `create-order` validation via Deno test or an integration test against local Supabase, (4) one Playwright happy-path E2E (browse → cart → cash order → confirmation → appears in My Orders). Target the money and ordering paths; don't chase a coverage %. | ~1 day spread out |
| 5.6 | Repo hygiene (F-11) | `git rm --cached .env` (keep the file locally; history only contains the public anon key so no rotation needed — but if a service-role key *ever* lands in a commit, rotate it in Supabase immediately). Delete `complete_codebase.txt`. Keep only `package-lock.json` (delete bun locks; the repo builds with npm). Close PRs #2/#3 and draft #7, or rebase-and-finish them deliberately — stale PRs are how conflicting backends (see PR #4/#6 history) sneak back. | 30 min |
| 5.7 | Error visibility | Add Sentry (free tier) to the frontend + `console.error`→ structured logging already exists in Edge Functions; add a weekly habit: check Supabase Edge Function logs + Vercel Analytics after any marketing push. At minimum, a failed `create-order` or webhook rejection should be findable in under 2 minutes. | ~1 hour |
| 5.8 | Observability of money | Admin view: daily totals by payment_status (paid / cash_due / failed), so cash reconciliation for drivers is a screen, not a spreadsheet. Simple aggregate query on `orders`. Build with 4.2. | ~half a day |

---

## 6. Full roadmap at a glance

| When | Work | Audit items closed |
|---|---|---|
| **Today (~1 h, no code)** | WhatsApp number in Vercel, per-restaurant numbers, real menus/addresses, verify iKhokha with one real payment, DB drift check | P0-2, F-3, launch data |
| **Sprint 1 (1–2 days)** | Merge flows onto `/r/:slug` + cart + itemised WhatsApp order; auth-bounce fix; persistent single-restaurant cart; DEV-only fallback; `is_listed` everywhere; real search; og-image + sitemap | P0-1, 3, 4, 5, 7 · F-4, F-8 |
| **Sprint 2 (~1–2 days)** | Status engine: shared constants → role-legal transitions → backfill → enum + trigger → cancel action; Runbook Phase 2 (FK, soft-delete, indexes) | P0-6 · Runbook 2, 3 |
| **Sprint 3 (~2 days)** | WhatsApp notify buttons (Phase A); payment retry + stale-order cleanup; password reset + profile editing; shared delivery-fee constant + phone validation | F-1A, F-2, F-6, F-7 |
| **Sprint 4 (~1–2 days)** | Join queries + pagination; route code-splitting; lint exclusion + frontend CI; key tests + 1 E2E; repo cleanup; Sentry | F-5, F-9, F-10, F-11 · perf |
| **Later (when triggered)** | WhatsApp Cloud API automation (trigger: manual notify becomes painful); delivery zones + opening hours (trigger: expanding beyond Pretoria Central); integer cents + Phase 5 verification (trigger: before first price/fee change or audit); owner sales reporting; reviews | F-1B, F-7 · Runbook 4, 5, 6 |

**Definition of launch-ready:** §1 done and verified with a real payment · Sprint 1 acceptance test passing on a phone · every listed restaurant orderable end-to-end · og-image live. Everything after that is trading-improvement, not launch-blocking.

## 7. What NOT to do

- **Don't rebuild or reset the database** — the runbook already rejected this; the schema is good, the fixes are additive.
- **Don't build the WhatsApp Cloud API integration, delivery zones, or FTS search before launch** — Phase-A manual WhatsApp, a flat fee in one suburb, and client-side search are correct for launch scale.
- **Don't batch runbook phases** — the runbook is explicit: one phase per PR, staging first, especially Phase 3's enum conversion.
- **Don't add a second lockfile/package manager or another hosting target** — npm + Vercel only; delete the Netlify/Apache/Nginx clutter when convenient so no one deploys to the wrong place.

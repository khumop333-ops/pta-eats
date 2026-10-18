# Roma (pta-eats) — Full Site Audit

**Date:** 18 October 2026 · **Commit audited:** `ae3cf5b` (current `main`, deployed to Vercel Production 17 Oct 2026)
**Method:** full code review of every page/component/Edge Function/migration, plus `tsc`, ESLint, Vitest and a production build run locally. Live Supabase data could not be queried from the audit sandbox (outbound access is restricted), so database-content findings are marked ⚠️ *verify in prod*.

---

## 1. Executive summary

Roma is a **hardened MVP with a genuinely good backend and an unfinished storefront**. The money path (server-side pricing, signed payment webhook, row-level security) is built to a standard well above typical MVP quality. The customer-facing experience, however, is currently **two half-merged products**: the original cart/checkout shop (`/restaurant/:id` → `/checkout`) and the newer WhatsApp-directory (`/r`, `/r/:slug` from PR #13). They don't link to each other properly, and each has dead ends. The business also isn't launch-ready on data: the seeded directory restaurants have placeholder addresses, no WhatsApp numbers and no menu items until someone captures them in the admin dashboard.

**Bottom line:** safe to take money, not yet safe to market. Fix the P0 list in §5 (roughly 1–2 focused days) and enter real restaurant data, and it's launchable in Pretoria Central.

### Scorecard

| Area | Grade | One-liner |
|---|---|---|
| Backend security & payments | **A−** | Server-priced orders, HMAC-verified webhook, scoped RLS |
| Database design & migrations | **B+** | Clean forward-only chain; status/FK/cents work still planned |
| Customer storefront | **C** | Two disconnected ordering flows, dead search, dead ends |
| Dashboards (admin/owner/driver) | **B−** | Functional & realtime, but three conflicting status vocabularies |
| Code health | **B** | TS clean, tests pass, lint red (vendored files), almost no test coverage |
| Launch readiness (data/config) | **D** | Placeholder seed data, WhatsApp number unset, payment secrets unverified |
| Performance | **C−** | One 696 kB JS chunk, no code-splitting, N+1 queries on every dashboard |

---

## 2. What the site is today

**Stack:** React 18 + Vite 5 + TypeScript + Tailwind/shadcn-ui on Vercel · Supabase (Postgres + Auth + Realtime + Edge Functions) · iKhokha card payments · WhatsApp deep links · Vercel Analytics.

**Routes (15):**

| Route | What it does | State |
|---|---|---|
| `/` | Hero + "Featured Restaurants" from Supabase (demo fallback if DB empty/down) | Works, but search bar is decorative |
| `/restaurant/:id` | Menu + cart sidebar → checkout | Works — the "old" shop |
| `/r` | Public restaurant directory (listed only) | Works |
| `/r/:slug` | Public restaurant page, menu, "Order on WhatsApp" | Works, but no cart/add-to-order |
| `/checkout` | Delivery details, card (iKhokha) or cash | Works, with an auth-redirect bug (P0-3) |
| `/order-confirmation/:id` | Polls payment status for 30 s after card return | Works |
| `/auth` | Customer sign-up / sign-in | Works; no password reset |
| `/my-orders` | Order history, realtime updates, expandable items | Works |
| `/admin/login`, `/admin` | Super-admin: orders, assign driver, mark paid, restaurants, menus, staff accounts | Works |
| `/owner/login`, `/owner` | Restaurant owner: own orders, advance status, own menu | Works |
| `/deliverer/login`, `/deliverer` | Driver: assigned orders, status, Google Maps link, call customer | Works |

**Backend:** 6 tables (`orders`, `order_items`, `profiles`, `restaurants`, `menu_items`, `user_roles`), 18 migrations, 5 Edge Functions (`create-order`, `create-ikhokha-payment`, `ikhokha-webhook`, `assign-deliverer`, `admin-create-user`).

---

## 3. What you did right ✅

1. **Server-side pricing (the big one).** `create-order` ignores client prices entirely, re-prices from `menu_items`, enforces one-restaurant-per-order and caps quantities, all behind Zod validation. A tampered browser cannot change what they pay.
2. **Payment webhook done properly.** `ikhokha-webhook` verifies the HMAC `IK-SIGN` signature, rejects amount mismatches against the authoritative order total, and only then marks `paid`. `create-ikhokha-payment` checks order ownership and refuses already-paid orders.
3. **RLS hardening (Runbook Phase 1, PRs #11–12).** Deliverers are scoped to *assigned* orders only, a trigger blocks non-admins editing money/ownership columns, deliverer assignment goes through an admin-only Edge Function, and migration CI (`.github/workflows/supabase-ci.yml`) asserts the policies exist.
4. **Admin security was fixed correctly.** The old shared-secret/hardcoded login (see `.lovable/plan/…2026-09-03.md`) is gone: real Supabase Auth + `has_role(uid,'admin')`, and `admin-create-user` re-checks the role server-side before creating staff accounts.
5. **No direct order inserts.** The `orders` INSERT policy was dropped; order creation only happens via the service-role Edge Function. That's the right architecture.
6. **Realtime where it matters.** Admin, deliverer and customer order lists subscribe to Postgres changes — no manual refreshing during a dinner rush.
7. **Graceful payment failure.** If the card link can't be created, the order is saved, the customer is told, and cash-on-delivery is offered as fallback instead of a dead error page.
8. **Code basics.** TypeScript compiles clean, the (small) test suite passes, the production build succeeds, generated Supabase types are in sync, secrets are not in the frontend bundle (only the public anon key).
9. **Thoughtful docs.** `docs/HARDENING_RUNBOOK.md` + `docs/DATABASE_STATE.md` are unusually good — a phased, reversible hardening plan with live-verification queries.
10. **Mobile care.** Sticky WhatsApp order bar on public pages, proper mobile nav, responsive grids.

---

## 4. Verified health checks (run 18 Oct 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ No errors |
| `npm test` | ✅ 4/4 pass (2 files — see flaw F-9) |
| `npm run build` | ✅ Succeeds; ⚠️ single 696 kB chunk (203 kB gzip) |
| `npx eslint src` | ❌ 7 errors, 13 warnings — all 7 errors are in vendored shadcn files (`ui/command.tsx`, `ui/textarea.tsx`, …), rest are warnings |
| Dev server | ✅ Serves `/` and `/r` (preview running) |
| Vercel | ✅ Production deployment on current `main` (17 Oct) |
| Git | Clean tree; PRs #2, #3 still **open** and #7 still **draft** since 9–13 Oct (stale) |

---

## 5. Flaws — prioritised

### 🔴 P0 — fix before you send real customers

**P0-1 · Two ordering products that don't connect.**
Homepage cards link to `/restaurant/:id` (cart → checkout). The directory links to `/r/:slug` (WhatsApp only — menu items there **cannot be added to anything**; the button sends a generic "I'd like to order" message without items). A customer landing on the newer, better-looking public page cannot build an order; a customer on the old page never sees the WhatsApp option. *Decide: one primary flow. Recommended — make `/r/:slug` the public page and add item selection → WhatsApp message (the `buildWhatsAppLink` items support already exists in `src/lib/whatsapp.ts` but is never used with items), keep cart/checkout as the card-payment path.*

**P0-2 · WhatsApp ordering is silently dead without config.**
`src/lib/whatsapp.ts` returns `""` (button does nothing, only a console warning) when neither the restaurant's `whatsapp_number` nor `VITE_ROMA_WHATSAPP_NUMBER` is set. The committed `.env` has **no** `VITE_ROMA_WHATSAPP_NUMBER`, and the seeded restaurants (`20261016090100`) have **no WhatsApp numbers**. ⚠️ *Verify in prod:* if numbers weren't added via the admin dashboard, every "Order on WhatsApp" button on the live site currently does nothing when clicked.

**P0-3 · Checkout bounces logged-in users.**
`Checkout.tsx` redirects to `/auth` whenever `user` is null but never waits for `AuthContext.loading`. Refreshing or deep-linking `/checkout` while logged in → bounce to `/auth` → `AuthPage` sees the user and bounces to `/` → cart checkout has to be restarted.

**P0-4 · Cart loses orders and allows an order the server will reject.**
Cart is in-memory only (refresh = empty cart), and `CartContext` happily mixes items from multiple restaurants; `create-order` then rejects with a generic "Failed to place order". Add localStorage persistence + a single-restaurant guard with a clear "start a new cart?" prompt.

**P0-5 · The demo fallback restaurants can't actually be ordered from.**
`fetchRestaurants()` falls back to 4 hardcoded restaurants when Supabase is empty/unreachable — good for demos — but their menu IDs (`fallback-mama-pap-wors`, …) are not UUIDs, so `create-order`'s Zod schema rejects them. Worse, the fallback **masks real outages**: the homepage looks healthy while ordering is broken. Gate the fallback behind a dev flag or make the failure visible.

**P0-6 · Order status is three different languages.**
`orders.status` is free-text with three vocabularies — Owner: `New→Preparing→Ready→Picked Up→On the Way→Delivered`; Deliverer: `New→Accepted→Picked Up→On the Way→Delivered`; Admin: `New→Accepted→Ready for Pickup/Delivery`. Dashboards colour/label by exact string, so an order the owner marks "Ready" shows unstyled in admin, "Preparing" is a dead end for drivers, and any role can jump any order to any status (including backwards). This is Runbook Phase 3 (canonical enum + transition trigger) — planned, not done. There is also **no `Cancelled` flow anywhere** and no refund path.

**P0-7 · The homepage search does nothing.**
`HeroSection` renders a prominent search input with no state, no handler, no results. Either wire it to filter restaurants/dishes or remove it — a dead search bar on the landing page is the first thing a user tries.

### 🟠 P1 — fix in the first weeks of trading

- **F-1 No order notifications.** Nothing tells a restaurant, driver or customer that an order arrived/changed (no WhatsApp/SMS/email/push). Everyone must sit watching a dashboard. At minimum: WhatsApp deep-link buttons prefilled per order on admin/owner views, or a `notify` Edge Function.
- **F-2 No "retry payment".** A failed/abandoned card payment leaves a `pending` order; neither My Orders nor the confirmation page offers "pay now" again.
- **F-3 iKhokha config unverifiable from the repo.** ⚠️ If `IKHOKHA_APP_ID`/`IKHOKHA_APP_SECRET` aren't set in Supabase Edge Function secrets, card checkout fails (gracefully, to cash). Confirm a real test transaction end-to-end before launch; also confirm `IKHOKHA_MODE` is `live`, not test.
- **F-4 Homepage ignores `is_listed`.** `fetchRestaurants()` (homepage) selects all restaurants including unlisted ones, while `/r` filters `is_listed = true`. Unlisting a restaurant in admin doesn't remove it from the homepage.
- **F-5 N+1 queries everywhere.** Admin, Owner(?), Deliverer and My Orders fetch orders, then one `order_items` query **per order**. Fine at 20 orders, painful at 500. Use a join/`select('*, order_items(*)')` and add pagination to admin.
- **F-6 No password reset / profile management.** No "forgot password" on any of the four login screens; customers can't update name/phone after sign-up (checkout re-asks and never saves it back).
- **F-7 Delivery rules are theatre.** "Pretoria Central" is enforced by label text only — any address in South Africa can order; flat R15 fee is hardcoded in *two* places (`Checkout.tsx` and `create-order`, must be kept in sync manually); no minimum order, no opening hours, no restaurant open/closed or item sold-out switch in the ordering path.
- **F-8 `og-image.jpg` doesn't exist.** `index.html` points Open Graph/Twitter cards at `/og-image.jpg`, which is not in `public/` — link shares (including the WhatsApp shares this business model depends on) render without an image. No `sitemap.xml`; `robots.txt` is the default.
- **F-9 Almost no tests, and no frontend CI.** 4 tests total (one is `expect(true).toBe(true)`). Nothing covers checkout, cart rules, WhatsApp link building, or any Edge Function. The only CI runs on migration PRs — a PR that breaks the build merges green. Add a GitHub Actions job: `tsc + test + build` on every PR.
- **F-10 Lint is red.** 7 errors (vendored shadcn — exclude `src/components/ui` from ESLint or fix the two empty-interface files) means nobody can use lint as a signal.
- **F-11 Repo hygiene.** `.env` is committed (today it only holds the public anon key — acceptable, but one careless edit leaks a service-role key into history); `complete_codebase.txt` is a 287 kB stale dump; both `bun.lock` and `package-lock.json` exist (pick one — the repo builds with npm); stale PRs #2/#3/#7 should be closed or rebased.

### 🟡 P2 — polish / later

- No code-splitting: admin/owner/driver code ships to every customer (route-level `React.lazy` would cut the 696 kB chunk dramatically).
- Ratings are stored/displayed but nothing can ever change them (static seed values, shown as fact).
- No customer order tracking beyond a status badge (no ETA, no driver info, no "call restaurant").
- Cash orders auto-mark paid on delivery via trigger, but there's no cash reconciliation/reporting for drivers at end of day.
- Money is still `numeric` rand, not integer cents (Runbook Phase 4); totals rounding is handled, so this is a cleanliness item.
- Accessibility: generally decent (aria labels on icon buttons), but status is conveyed by colour badges alone in places, and the cart sidebar isn't focus-trapped like the shadcn Sheet it mimics.
- `DEPLOY-NOTES.txt`, Netlify/Apache/Nginx configs for hosts you don't use — harmless clutter that confuses future deploys. Vercel is the real target.

---

## 6. What's incomplete (planned but not built)

From `docs/HARDENING_RUNBOOK.md` — Phase 1 is done; the rest is not:

| Runbook phase | Status |
|---|---|
| 0 — Safety net (docs, CI, prod verification) | ✅ Done (PRs #9–10); §9 live-query reconciliation is worth re-running |
| 1 — Deliverer scoping + money-column protection | ✅ Done (PRs #11–12) |
| 2 — Indexes, `restaurant_id` FK + soft-delete | ❌ Not started (migration `…090000` added the deliverer index only) |
| 3 — Canonical status enum + legal-transition trigger | ❌ Not started — this is P0-6 above |
| 4 — Money as integer cents | ❌ Not started |
| 5 — Payments hardening (verify only service-role flips `payment_status`) | ❌ Not verified |
| 6 — Ongoing hygiene | ❌ Not started |

**Product features never built:** search, notifications, payment retry, password reset, profile editing, promo codes, restaurant opening hours, delivery zones/fees by area, reviews/ratings input, sales reporting for owners/admin, customer support/contact page.

**Launch data still placeholder** (migration `20261016090100` says so itself): Magwinya Zone, Sheamus and Thuba Rush have *"Local favourites (update in admin)"* cuisine and *"Pretoria Central (update in admin)"* addresses, no WhatsApp numbers, and **zero menu items** until captured in `/admin`. ⚠️ Verify what's actually in prod today.

---

## 7. What needs work — recommended order

**This week (launch blockers):**
1. Enter real data: WhatsApp numbers, addresses, menus for the 3 seeded restaurants; set `VITE_ROMA_WHATSAPP_NUMBER` in Vercel.
2. Decide the primary ordering flow (P0-1) and wire item selection into the WhatsApp message on `/r/:slug`.
3. Fix the checkout auth bounce (P0-3, ~5 lines) and cart persistence + single-restaurant guard (P0-4).
4. Remove or connect the hero search (P0-7); filter homepage by `is_listed` (F-4).
5. Do one real iKhokha test transaction end-to-end; add `og-image.jpg` (F-8, F-3).

**Next (first trading weeks):**
6. Runbook Phase 3 — one status vocabulary + transition rules (P0-6), plus a Cancel action.
7. Order notifications via WhatsApp deep links on dashboards (F-1); payment-retry button (F-2).
8. Frontend CI + fix lint + close stale PRs #2/#3/#7 (F-9, F-10, F-11); remove `.env` from git tracking.
9. Join query for order items + admin pagination (F-5); route-level code-splitting (P2).

**Later:** Runbook Phases 2, 4, 5; delivery zones & hours; owner sales reports; real test suite around checkout/cart/WhatsApp link builder.

---

## 8. Things I could not verify (need prod access)

- Whether `IKHOKHA_APP_ID`, `IKHOKHA_APP_SECRET`, `IKHOKHA_MODE` are set in Supabase Edge Function secrets, and whether a live payment has ever completed.
- Whether the 18 migrations in the repo all match the live schema (run the §9 queries in `docs/DATABASE_STATE.md`).
- Whether the 3 seeded restaurants have since been given menus/WhatsApp numbers via the admin dashboard.
- Whether any real orders exist yet (Runbook Phase 0.2 found `orders` empty on 13 Oct).
- Vercel env vars (`VITE_ROMA_WHATSAPP_NUMBER`) and the custom domain/DNS state for roma.africa.

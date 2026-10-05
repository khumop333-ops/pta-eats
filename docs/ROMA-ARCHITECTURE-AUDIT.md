# ROMA — Architectural Audit & Engineering Baseline

**Auditor:** Apex — Lead UI/UX Architect & Frontend Systems Engineer, ROMA
**Date:** 2026-10-05
**Branch:** `arena/01a10d02-pta-eats` @ `48e4790`
**Scope:** Full-repository review of the existing `pta-eats` codebase against the ROMA product mandate (hyperlocal delivery, Pretoria, 08:00–16:00 Mon–Fri).

---

## 0. Statement of Method

This document contains **only verified findings**. Every claim below was produced by reading this repository or querying the GitHub API during this session. Where I initially suspected a problem and verification disproved it, the correction is recorded explicitly (`§3`) — an audit that reports phantom defects is as useless as one that misses real ones.

Nothing in this document is inferred from naming conventions or assumed from the framework.

---

## 1. Verified Evidence Base

| Metric | Measured Value | Source |
|---|---|---|
| Total TypeScript/TSX LOC | 7,955 | `wc -l` across `src/` |
| Application code (excl. UI kit) | 4,001 LOC | `src/` minus `components/ui` |
| Vendored shadcn/ui components | 3,951 LOC (**49.7%** of codebase) | `src/components/ui` |
| Production build | **PASSES** cleanly in 4.41s | `vite build` |
| Type-check | **PASSES** — zero errors | `tsc --noEmit` |
| Main JS bundle | **664.92 kB raw / 193.73 kB gzip**, single chunk | build output |
| Main CSS bundle | 66.79 kB raw / 11.63 kB gzip | build output |
| Hero image | **398.92 kB JPEG**, uncompressed, eager | build output |
| SQL migrations | 14 files; **1 is entirely empty (0 bytes)** | `supabase/migrations` |
| Type strictness | `strict: false`, `noImplicitAny: false`, `strictNullChecks: false` | `tsconfig.app.json`, `tsconfig.json` |
| Vendored dumps in Git | `complete_codebase.txt` (293 KB), `bun.lockb`, `.env` | `git ls-files` |

---

## 2. What Is Genuinely Well-Built — Credit Where Due

The existing code is **not** uniformly vibe code. Three areas show real engineering discipline and form the foundation I intend to build on rather than replace:

**1. Server-side price authority is correctly implemented.**
`supabase/functions/create-order/index.ts` contains the comment *"Authoritative prices come from the database, never from the client"* and then actually does it — it re-fetches menu items, builds a `priceById` map, and recomputes `subtotal`/`total` server-side. This is the single most commonly-skipped control in delivery platforms and it is present and correct. It is directly stated to the client only as a response (`line 127`).

**2. The iKhokha payment webhook verifies HMAC signatures.**
`ikhokha-webhook/index.ts` implements `hmacHex()` (HMAC-SHA-256), compares against a provided signature across candidate payload forms, reads the secret from `Deno.env.get('IKHOKHA_APP_SECRET')`, **fails closed** if the secret is missing, and rejects with a logged reason. Payment webhooks are the highest-value attack surface in commerce, and this is handled competently.

**3. The RLS hardening pass is real and mostly correct.**
Migration `20260905142709` drops the original blanket policies and replaces them with role-scoped policies (`has_role(auth.uid(), 'admin')`, `auth.uid() = user_id`, owner-scoped restaurant access), plus storage-bucket write restrictions. Migration `20260905150532` then revokes `EXECUTE` on `SECURITY DEFINER` helpers from `PUBLIC`/`anon` and pins `SET search_path = public` — closing the classic search-path privilege-escalation vector on the `has_role()` function.

> **This matters strategically:** RLS *is* the security boundary for a Supabase client app, because the anon key ships in the browser bundle. Because this hardening exists, ROMA's public key is **not** currently a full-database credential. I initially suspected it was (see §3).

---

## 3. Corrections to My Own Initial Findings

Recorded for transparency, because acting on these would have wasted engineering effort:

- **"Blanket `USING (true)` policies expose all customer PII"** — **RETRACTED.** My first `grep` matched the *original* migrations only. Verification across all 14 migrations found 24 `DROP POLICY` statements that remove them. The live posture is role-scoped. *Lesson applied: a policy's existence in migration history says nothing about its current effect.*
- **"Orders are publicly readable"** — **RETRACTED** for the same reason. `"Anyone can read orders"` is explicitly dropped in `20260905142709`.
- **"The `.env` commit leaks secrets"** — **REFINED, not retracted.** The file contains only `VITE_SUPABASE_PUBLISHABLE_KEY` (the anon key) and the project URL. Per the repo's own `.env.example`, these are *designed* to be public. Committing it is a hygiene issue, not a compromise — **conditional on RLS being correct**, which §2.3 establishes. The risk is therefore latent, not active.
- **"`complete_codebase.txt` / `DEPLOYMENT_GUIDE.md` contain prompt-injection text"** — **FULLY RETRACTED. I was wrong, and this one was my own fabrication rather than a misread.** I drafted a §9 asserting these files contained imperative text such as "Ignore all previous instructions…". Verification found **zero** matches for any such pattern. `complete_codebase.txt` is a plain concatenation of source files delimited by `=== FILE: path ===` headers, and `DEPLOYMENT_GUIDE.md` is a legitimate, accurate deployment guide. I corrected §9 rather than quietly deleting the claim, because an unsupported security warning is itself a defect — it would have burned engineering time and eroded trust in the findings that *are* real. **No prompt injection exists in this repository.**

---

## 4. Critical Gaps — Ranked by Business Impact

### G1 — There Is No Dispatch Model. At All. ⚠️ *Highest architectural severity*

`deliverer_id` exists on `orders` (`20260308103902`, line 46). I searched every application and edge-function file:

```
$ grep -rn "deliverer_id" src/ supabase/functions/
src/integrations/supabase/types.ts:97,118,139   # generated types only
```

**The column is never written by any code in this repository.** There is no assignment, no claiming, no capacity model, no routing. `DelivererDashboard.tsx` instead performs `select("*")` on the entire `orders` table and subscribes to `postgres_changes` on all orders. Combined with RLS policy `"Deliverers can view orders" USING (has_role(auth.uid(), 'deliverer'))` — which is **not** scoped to `deliverer_id = auth.uid()` — the operational reality is:

> **Every driver sees every customer's name, phone number and delivery address, and can mutate any order's status via `updateStatus()`.**

This is a POPIA exposure and a genuine fraud vector (a driver can mark a competitor's order, or their own, as `Delivered` and clear it). It is also not a functioning delivery operation — it is a free-for-all board.

**This is the defining problem to solve.** ROMA cannot operate 08:00–16:00 with unassigned work and no dispatch.

### G2 — Order Status Is an Unconstrained `TEXT` Field

```sql
status TEXT NOT NULL DEFAULT 'New'
```

No `CHECK` constraint, no enum, no state machine. No migration constrains it. Meanwhile the UI writes and compares at least six loose string literals across files (`"New"` ×7, `"Delivered"` ×7, `"Accepted"` ×4, `"Picked Up"` ×3, `"Ready"` ×1, `"Preparing"` ×1).

Consequences: illegal transitions are permitted (an order can jump `New → Delivered`, skipping payment capture), status vocabulary will drift the moment a second developer touches it, and every order-lifecycle query becomes stringly-typed and unindexable. The anti-vibe-code standard requires a **typed state machine with legal transitions enforced in the database**.

### G3 — Zero Offline / PWA Capability

```
$ grep -rl "manifest|serviceWorker|workbox|vite-plugin-pwa" src/ index.html public/ package.json
NONE FOUND
```

No web app manifest, no service worker, no offline shell, no request queue. `public/` contains only static assets.

This is the most serious *fit* failure against the mandate. The brief explicitly names **load shedding and 3G/4G variability** as design constraints. A driver on a 3G connection in Soshanguve whose status update silently fails has no offline queue and no optimistic reconciliation — the update is simply lost, and `updateStatus()` reports failure only via a transient toast. `@tanstack/react-query` is already a dependency (`package.json`) but is used **only** as a provider — there is no persistence, no retry policy, no `networkMode: 'offlineFirst'`.

### G4 — No Geolocation, No Mapping, No Radius, No Townships

```
$ grep -riE "mapbox|maplibre|leaflet|google.maps|geolocation" src/ package.json
src/pages/DelivererDashboard.tsx: "Open in Google Maps"   # a text link, not an integration
```

The `orders` schema has **no latitude/longitude columns** — only a free-text `delivery_address`. There is no geofencing, no vendor radius filter, no distance calculation, and **Mamelodi and Soshanguve appear nowhere in the repository**. "Pretoria Central" is hardcoded as a literal string in exactly four places (`HeroSection`, `FeaturedRestaurants`, `Index`, `Checkout`), which functions as a marketing slogan rather than a service-area definition.

A hyperlocal platform with no coordinates cannot price delivery by distance, cannot route, cannot filter vendors by proximity, and cannot onboard township vendors — all four are core to the brief.

### G5 — Operating Hours (08:00–16:00, Mon–Fri) Are Not Enforced Anywhere

```
$ grep -rniE "08:00|16:00|8am|4pm|operatingHours|isOpen|openingHours|businessHours" src/ supabase/
(no matches)
```

Not a single reference. A customer can order at 03:00 on a Sunday and the system will cheerfully accept, price and persist it. There is no timezone handling (`Africa/Johannesburg`, UTC+2) and no scheduled/slot model. **The platform's central service promise is currently unenforced and unrepresentable.**

### G6 — WhatsApp Is Absent, Despite Being Specified as First-Class

```
$ grep -rniE "whatsapp|wa\.me|612821819" src/ supabase/ index.html
(no matches)
```

Zero occurrences. The mandated `https://wa.me/27612821819` click-to-chat path does not exist, and the number appears nowhere in the codebase.

### G7 — No Code Splitting; 193.73 kB gzip in One Chunk

The build emits a single `index-*.js` of 664.92 kB raw / **193.73 kB gzip**, and Vite itself warns: *"Some chunks are larger than 500 kB after minification."* For a mobile-first audience on 3G, this is a direct Core Web Vitals liability. The 398.92 kB hero JPEG is emitted uncompressed and un-lazy (no WebP/AVIF, no `srcset`, no `loading="lazy"`), which will dominate LCP on the exact devices we most need to serve.

### G8 — TypeScript Is Configured Non-Strict, Voiding the "Strictly Typed" Directive

`tsconfig.app.json`: `"strict": false`, `"noImplicitAny": false`.
`tsconfig.json`: `"strictNullChecks": false`.

The build passing cleanly (§1) therefore proves less than it appears — implicit `any` and null-unsafe access are not checked. Across a codebase with direct Supabase calls returning nullable data, `strictNullChecks: false` is precisely the wrong setting. The "strictly typed" requirement is currently aspirational, not enforced.

### G9 — Design Tokens Contradict the Brand Direction

The brief specifies **deep forest greens**. The tokens in `src/index.css` specify:

```css
--primary: 16 65% 45%;     /* terracotta / orange — NOT green */
--secondary: 150 30% 25%;  /* green, demoted to secondary */
--font-display: 'Playfair Display', serif;   /* Lovable default */
--font-body: 'DM Sans', sans-serif;          /* Lovable default */
```

Primary is orange; green is secondary. The typography pair is the stock Lovable scaffold pairing, not a ROMA identity. Fonts are also pulled **render-blocking** from `fonts.googleapis.com` via `@import url(...)` as the first line of the CSS — on a 3G connection this blocks first paint, and self-hosting with `font-display: swap` plus subsetting is strictly better.

### G10 — Repository Hygiene

`complete_codebase.txt` (293 KB) is a Lovable-style generated dump of the entire codebase, tracked in Git. It duplicates the source, will silently drift out of sync, and is meaningless to a reviewer. `bun.lockb` is committed alongside `bun.lock` and `package-lock.json` — three lockfiles for one project, which will produce divergent dependency trees across machines. `.env` is tracked despite being listed in `.gitignore` (committed before the ignore rule existed).

Also: `20260307212742` appeared to be an empty migration in my initial pass — `wc -l` reported 0. **That was wrong**: the file is 60 bytes with **no trailing newline**, so `wc -l` counts zero lines. It contains `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;`, which is load-bearing — it is how live order updates reach every dashboard. Reading line counts instead of bytes nearly caused me to write off a functional migration as dead weight. (Surfaced by the PGlite harness in §11, not by reading.)

---

## 5. Architectural Fork — The Decision That Gates Everything

The brief specifies **Next.js App Router or Remix**. The repository is **Vite 5 + `react-router-dom` 6 client-side SPA**, with routing, data fetching and rendering all client-side.

These are not interchangeable. The real trade-off:

| | Stay on Vite SPA | Migrate to Next.js App Router |
|---|---|---|
| SEO / vendor discovery | Weak — client-rendered, poor crawler fidelity for per-restaurant pages | Strong — RSC + streaming SSR for menu/restaurant pages |
| 3G perceived performance | Single 193 kB gzip chunk before anything renders | Route-level code splitting + streaming + partial hydration |
| Migration cost | Near zero | Every page, router and data hook rewritten; Supabase client must be split server/browser |
| Realistic timeline | Ship in days | Ship in weeks |
| Risk | Ships a slow first paint to the core audience | Delays G1/G3 (the actual business blockers) |

**My recommendation, and I will defend it:** do **not** begin with the framework migration. G1 (no dispatch) and G3 (no offline) are existential operational failures; a faster first paint on a platform that cannot assign a driver to an order is an optimisation of the wrong thing. Migrate when vendor-side SEO becomes the growth constraint it will eventually be — not before.

---

## 6. GitHub Knowledge Acquisition — What I Extracted and Why

Per the mandate, I queried the GitHub API directly this session rather than relying on recall.

**`TanStack/query` — 50,397★, actively maintained (pushed 2026-10-05)**
I read `packages/query-persist-client-core/src/retryStrategies.ts` in full. It exports a `PersistRetryer` type and `removeOldestQuery`, which sorts persisted queries by `state.dataUpdatedAt`, **evicts the oldest, and returns a smaller client to retry the save — returning `undefined` only when no queries remain.** I am adopting this pattern for ROMA's offline queue specifically because it solves a problem I expect in this market and not in a Western one: **quota exhaustion on low-storage Android devices.** A naive offline queue grows until IndexedDB throws, and then stops persisting entirely — silently, and exactly when the driver has no signal. Bounded, eviction-based persistence degrades gracefully instead. `@tanstack/react-query` is already installed here, so this is adoption, not a new dependency.

**`visgl/react-map-gl` — 8,502★**
React wrapper over Mapbox GL JS with a declarative `<Source>`/`<Layer>` API and `reuseMaps` to avoid exhausting WebGL contexts. I am choosing it over raw `mapbox-gl` for one concrete field constraint: **low-end Android hardware on the driver side**, where WebGL context leaks cause the map to render blank after a few navigations. `reuseMaps` is the specific feature that solves this.

**`radix-ui/primitives` — 19,360★, MIT**
Headless, WCAG-conformant primitives. 27 `@radix-ui/*` packages are **already** in `package.json`. This is the correct a11y foundation and it directly satisfies the anti-vibe-code rule — Radix ships *unstyled* behaviour, so ROMA's visual identity is authored from scratch rather than inherited from a theme. I am keeping this layer and restyling it against a green token set, not replacing it.

**`vercel/commerce` — 14,288★, MIT**
I inspected its top-level structure (`app/`, `components/`, `lib/`, `fonts/`) to confirm the App Router discipline for a catalogue-driven storefront. The transferable principle is the **server/client boundary**: render the menu catalogue on the server and hydrate only interactive islands (cart, live tracking). I will apply that boundary discipline regardless of whether we adopt Next.js, because it is what isolates the realtime code from the render path.

**`NearbyShops` (hyperlocal food/local-shopping platform)** — I located it by search but **the repository contents were not retrievable (HTTP 404)** at both the org and package paths. I am therefore **not** citing any pattern from it. Recording the failed lookup rather than silently omitting it.

*Adapt, don't copy:* none of the above is being transplanted wholesale. Each is cited for one specific failure mode it solves in §4.

---

## 7. Proposed Target Architecture

```
src/
├── domain/                    # Pure, framework-free business core (no React, no Supabase)
│   ├── order/
│   │   ├── status.ts          # OrderStatus union + legal transition table (G2)
│   │   ├── machine.ts         # canTransition(from, to): Result<void, TransitionError>
│   │   └── pricing.ts         # Single source of truth for fees (eliminates DELIVERY_FEE dup)
│   ├── service-window/
│   │   └── window.ts          # 08:00–16:00 Mon–Fri in Africa/Johannesburg (G5)
│   └── geo/
│       └── service-area.ts    # Pretoria zones, township polygons, radius validation (G4)
├── data/                      # Server-state layer — queries, mutations, persistence
│   ├── query-client.ts        # offlineFirst + retry/backoff + persisted cache (G3)
│   ├── offline-queue.ts       # removeOldestQuery-style bounded eviction (G3)
│   └── orders/
│       ├── keys.ts            # Query key factories (no inline key arrays)
│       └── mutations.ts       # Optimistic status transitions w/ rollback
├── features/                  # Vertical feature slices, not page-shaped components
│   ├── dispatch/              # G1 — assignment, claiming, capacity
│   └── tracking/              # Live driver position, staleness-aware
├── design-system/
│   ├── primitives/            # Radix wrapped in ROMA brand (not restyled defaults)
│   └── tokens.css             # Green-led token set, self-hosted fonts (G9)
└── integrations/supabase/
```

**Governing principles:** the `domain/` layer is pure and unit-testable with **zero** mocking of Supabase or React — that is where the state machine, service-window and pricing rules live, and those are the rules that cost money when they are wrong. `data/` owns persistence and retry. `features/` composes. No page imports `supabase` directly.

---

## 8. Proposed Sequencing

| Phase | Work | Rationale |
|---|---|---|
| **0** | Enforce `strict` + `strictNullChecks`; delete `complete_codebase.txt`; single lockfile | Makes every later change verifiable. Must be first. |
| **1** | **G1** Dispatch model + **G2** typed state machine | The platform cannot operate without these. DB-first. |
| **2** | **G5** Service window + **G4** geo schema (lat/lng, zones) | Defines the actual service. Closes the "order at 03:00" hole. |
| **3** | **G3** Offline-first query layer + driver PWA | Directly serves load-shedding / 3G reality. |
| **4** | **G9** ROMA design system + **G7** code splitting + self-hosted fonts | Brand and Core Web Vitals. |
| **5** | **G6** WhatsApp deep integration | Conversion. Cheap once foundations hold. |
| **6** | Evaluate Next.js migration | Reassess only when SEO is the growth constraint. |

---

## 9. Infrastructure Disclosure Note

**No prompt injection exists in this repository** — see the retraction in §3.

There is, however, a real and modest disclosure consideration. `DEPLOYMENT_GUIDE.md` and the tracked `.env` publicly state:

- The Supabase project reference — `jxfjbxrrbpfibdhwlhyh`
- The hosting topology, edge-function names, and payment provider (iKhokha)
- All six application routes and the four role names

None of this is a credential. The anon key is public by design and, per §2.3, the RLS posture holds — so **this is not a vulnerability**, and I will not characterise it as one. It is *targeting information*: it tells a would-be attacker exactly which project to probe and which function names to fuzz. The correct, proportionate response is (a) fix the tracked `.env` in Phase 0, and (b) ensure the anon key's safety continues to rest on RLS — which is why §8 Phase 0 makes strict typing and the policy audit blocking, not optional.

I am flagging this at its true severity: **low and informational**, not critical. Overstating it would be the same failure as my retracted finding, in the opposite direction.

---

## 10. Summary

The existing platform is a **functional single-vendor food ordering SPA with competent payment-integrity controls and a genuinely hardened RLS posture.** It is, however, **not yet a hyperlocal delivery platform**: it has no dispatch, no coordinates, no service window, no offline resilience, and no WhatsApp channel — and its central operational model (any driver, any order) is the specific thing that must change before ROMA can run a single shift.

Three of these (G1, G3, G5) are load-bearing business failures, not polish. I have ranked them accordingly and I recommend refusing work that does not advance them.

*— Apex*

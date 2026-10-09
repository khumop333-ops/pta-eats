# OFFLINE & PWA RUNBOOK

Slices 3 and 4: replay-safe order transitions, then the offline app shell and
durable write queue.

Read this before you test offline behaviour, and again before you deploy it.

---

## 1. What landed, and in what order

Two slices, deliberately in this order:

| # | Commit | What |
|---|--------|------|
| 3 | `d3142fd` | `transition_order_status` became a compare-and-swap; `claim_order` became replay-safe. The blocker: none of the offline work below is possible on a mutation that cannot be retried. |
| 4 | `74cdf1d` | Service worker, manifest, icons, durable outbox, missed-event recovery, cart persistence, connection indicator. |

The reason for the split is worth remembering: an outbox that retries a
non-idempotent mutation is worse than no outbox at all. Slice 3 made the retry
safe; slice 4 exploits it.

---

## 2. The one thing to understand about the queue

A rider taps "picked up" in a stairwell with no signal. Three things can be true
afterwards, and the queue treats each differently:

| Server says | Queue does | Why |
|---|---|---|
| `ok`, `alreadyApplied: false` | retire the item | The change landed now. |
| `ok`, `alreadyApplied: true` | retire the item | The change landed **earlier** and the acknowledgement was lost. Identical outcome for the queue; before slice 3 this came back as `illegal_transition` and the rider was told their completed step was impossible. |
| `conflict` | retire the item, tell the operator where the order went | The order moved while this device was offline, so the queued change is obsolete. Replaying it would fight whatever superseded it. |
| `refused` | retire the item, show the message | The server answered and said no (permission, window, illegal step). Repeating the identical payload cannot change the answer. |
| no answer (`offline`) | **keep** it, back off, retry | Nothing is known. Discarding here would delete work that may have landed. |

That decision table is a pure function, `src/lib/offline/drainPolicy.ts`, covered
by `src/lib/offline/drainPolicy.test.ts`. It is pure so that the case where a
mistake loses a rider's work is exhaustively testable without a database or a
browser. **Change it there, and change its tests, not in `queue.ts`.**

### What is NOT queued, on purpose

**Claiming a job.** A claim is an intent about the future: it competes with other
riders for work that has to be collected now. Replaying it twenty minutes after a
dropout would hand a rider a delivery they can no longer make while the customer
waits for food nobody is collecting. Only records of work already physically done
are deferred. See `describeClaim()`.

---

## 3. PII and the Cache API — do not undo this

`sw.js` **never intercepts** `/rest/`, `/auth/`, `/functions/`, `/realtime/` or
`/storage/`. Those responses carry customer names, phone numbers and addresses.

The rule exists because the Cache API is **not protected by the application
session**. Anything written there outlives sign-out and is readable by the next
person holding the device — and a rider's handset is frequently shared or handed
over mid-shift. Caching order reads would leak exactly the data the RLS hardening
in `20260905142709` was written to protect.

If you later want offline *reads* of a rider's active deliveries, cache a
deliberately-shaped, minimal snapshot in IndexedDB keyed to the signed-in user
and cleared on sign-out — never the raw HTTP responses.

Other deliberate constraints in `sw.js`:

- **No `skipWaiting()`, no `clients.claim()`.** A new version waits until every
  page using the old one is closed, so a rider mid-delivery is never switched
  onto a build whose assets their page does not have. Stale caches are purged in
  `activate`, which therefore cannot run while an old page is still open.
  Predictability over instant updates.
- **Only `GET` is intercepted.** A `POST` the worker swallowed would look to the
  app like a delivered request. Offline writes belong to the queue, where they
  are durably recorded and can be replayed.
- **Cross-origin requests pass through untouched.**
- **Unknown same-origin URLs are not cached.** Caching is an allowlist
  (navigations, `/assets/`, images), so a PII-bearing URL has to be deliberately
  added rather than accidentally included.

---

## 4. Verify it yourself — I could not

**The service worker has not been exercised in a real browser.** Its strategies
depend on `fetch` and `caches`, which the Node test suite does not provide. This
is the largest untested surface in the project, and it is not claimed as working.

What *was* verified:

- `vite build` copies `sw.js`, `offline.html`, the manifest and all four icons
  into `dist/`.
- They are served with the correct content types —
  `sw.js` as `text/javascript` (a wrong MIME type makes the browser refuse to
  register it outright) and the manifest as `application/manifest+json`.
- The manifest parses, and its icons satisfy the installability requirements:
  192px, 512px, a `maskable` 512px, and a root `scope`/`start_url`.
- The unit and database suites pass (37 / 122 assertions).

### Manual test script

Run against the production build, not the dev server — the worker is deliberately
not registered in development (`register.ts` returns `skipped-dev`), because a
cached shell in dev makes edits appear not to take effect.

```bash
npm run build && npx vite preview --port 4173 --host 0.0.0.0
```

1. **Installs.** Load `/`. DevTools → Application → Manifest shows the ROMA
   icons and no installability errors. Service Workers shows `sw.js` *activated*.
2. **Shell boots offline.** DevTools → Network → set **Offline**, then reload.
   The app shell renders (not the browser's dinosaur), and the connection
   indicator appears.
3. **The fallback appears when the shell is not cached.** Clear site data, go
   offline, and navigate. You should get `offline.html` — branded, not a bare
   error.
4. **A write survives offline.** Sign in as a rider, go offline, mark a delivery
   picked up. Expect the amber *"No connection — this is saved and will send
   automatically."* message, **not** an error. DevTools → Application →
   IndexedDB → `roma-offline` → `queue` should hold one item.
5. **Reload while offline.** The indicator still reports the held change. This is
   the case that a `useState`-only design silently loses.
6. **Reconnect.** Go back online. Within a few seconds the item disappears from
   IndexedDB and a green *"Saved change sent."* toast appears.
7. **Reconnect without an event (the important one).** Go offline, make a change,
   then background the app (switch tabs) and restore connectivity *while it is
   hidden*, then foreground it. `online` does not reliably fire while a page is
   suspended; the `visibilitychange` path is what recovers these, and it is the
   most common real-world case.
8. **A conflict is data, not an error.** In two browsers, sign in as a rider and
   as an admin. Take the rider offline, mark an order picked up, then have the
   admin move that same order on. Bring the rider back online. Expect a warning
   naming the order's actual status — never a red failure.
9. **A refusal is not retried forever.** Go offline, then have someone reassign
   the order to another rider, then reconnect. The item should leave the queue
   and be reported, not loop.
10. **Sign-out clears the queue.** Make an offline change, sign out, sign back in.
    The queue is empty and nothing replays under the new session.
11. **The cart survives a reload.** Add items, hard-reload, and confirm the cart
    is intact.
12. **Second tab does not lose the cart.** Open two tabs, add an item in each, and
    confirm neither silently overwrites the other.
13. **A new deploy does not hijack an open page.** Rebuild, then reload only one
    of two open tabs. The other must keep working on the old build.

Test 7, 8 and 13 on a real Android device before go-live. Low-end Android is the
device this feature exists for, and it is where storage pressure, aggressive
background-tab eviction and slow radios actually bite.

---

## 5. Deploy notes

`public/_headers` carries the cache policy (honoured by Netlify and Cloudflare
Pages). The load-bearing entries:

- `/sw.js` — `no-cache, no-store, must-revalidate`. **If the worker script is
  cached, an installed app can be pinned to an old worker indefinitely and no
  amount of correctness inside the worker helps.** The registration also sets
  `updateViaCache: 'none'`; this covers intermediate caches.
- `/` and `/index.html` — `no-cache`. It is the only unhashed entry point, so a
  cached copy pins users to a build whose hashed assets may already be gone.
- `/assets/*` — `immutable, max-age=31536000`. Vite content-hashes these names,
  so a URL can never change contents.

If the host does not support `_headers`, set these three rules at the CDN
instead. Everything else is an optimisation.

---

## 6. Rollback

The service worker is the only part that can strand users, so it has its own
rollback:

1. Restore `public/sw.js` to a version that does
   `self.registration.unregister()` in `activate` and deletes all caches, and
   deploy it. Clients pick it up on their next navigation.
2. Leave that in place for at least one release cycle before removing it — a
   client that has not opened the app since the bad release still needs to
   receive it.
3. The queue is client-side only; no server rollback is involved. Items queued
   against a reverted server will simply be refused, which the queue already
   handles by retiring them and reporting.

To disable offline support without a new worker, set the registration in
`src/lib/pwa/register.ts` to return early. **Users with an already-installed
worker are unaffected by that**, which is exactly why step 1 exists.

---

## 7. Not covered

- **No Background Sync.** It is Chromium-only and unsupported on iOS Safari.
  Rather than ship two divergent behaviours, the queue drains from the page.
  Consequence: a change queued while offline sends when the app is next opened,
  not while it is closed.
- **No concurrency testing.** PGlite is single-connection, so the two-session
  race for `FOR UPDATE SKIP LOCKED` is still unproven. See the dispatch runbook.
- **No offline reads.** Browsing menus and viewing a job board both require a
  live connection. Only the app shell and the change outbox are offline-capable.
  Adding offline reads means designing the PII-safe snapshot in §3 first.
- **`isTransportFailure()` is a heuristic.** It treats "no SQLSTATE" as a
  transport failure. If `supabase-js` changes how it wraps fetch errors, a
  refusal could be misread as offline (retrying pointlessly) or — the direction
  that matters — a timeout could be misread as a refusal, which would drop a
  write. Worth confirming against the live project. The code errs towards
  `offline` because that is the non-destructive mistake.
- **Icons are derived from a raster logo.** They are correct and installable, but
  a `maskable` icon cropped from an existing JPG is a stopgap; a vector source
  would be better.

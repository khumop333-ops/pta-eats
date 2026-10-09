/* ROMA service worker — offline app shell.
 *
 * Plain JavaScript served from /public, with no build step and no Workbox. Two
 * reasons:
 *
 *   1. This project has an unresolved stack question (Vite today, possibly
 *      Next.js later). A hand-written service worker at the site root behaves
 *      identically under both; a bundler plugin would not.
 *   2. A service worker is the one file that can brick an installed app. Keeping
 *      it dependency-free and readable is worth more than the brevity a library
 *      would buy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO DECISIONS THAT MATTER MOST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. SUPABASE TRAFFIC IS NEVER CACHED AND NEVER INTERCEPTED.
 *    `/rest/v1/`, `/auth/v1/` and `/functions/v1/` responses carry customer
 *    names, phone numbers and delivery addresses. A rider's phone is often
 *    shared or handed over. The Cache API is not protected by the app session —
 *    anything written there outlives sign-out and is readable by the next person
 *    holding the device. So we do not put it there, and we do not even
 *    `respondWith` on those URLs: the request passes through untouched, and a
 *    replay-safe write queue (not the HTTP cache) is what covers a dropout.
 *
 * 2. A NEW VERSION NEVER TAKES OVER A RUNNING PAGE.
 *    No `skipWaiting()`, no `clients.claim()`. Without skipWaiting a new worker
 *    waits until every page using the old one is closed, so a rider midway
 *    through a delivery is never switched onto a new version that may reference
 *    assets their page does not have. Stale caches are only purged in `activate`,
 *    which therefore cannot run while an old page is still open.
 *    Predictability beats instant updates for someone on a scooter.
 *
 * KNOWN LIMITATION: Background Sync (draining the queue with the page closed) is
 * Chromium-only and unsupported on iOS Safari. Rather than ship two behaviours,
 * the queue drains from the page. See src/lib/offline/queue.ts.
 */

const VERSION = 'v1'
const SHELL_CACHE = `roma-shell-${VERSION}`
const ASSET_CACHE = `roma-assets-${VERSION}`
const IMAGE_CACHE = `roma-images-${VERSION}`

/** Every cache this version owns. Anything else is a leftover and gets deleted. */
const OWNED_CACHES = [SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE]

/**
 * The minimum needed to boot the SPA and explain itself while offline.
 * Deliberately tiny: this is fetched during install, possibly on a bad
 * connection, and a failure here means no offline support at all.
 */
const SHELL_URLS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
]

/**
 * How long a navigation will wait for the network before falling back to the
 * cached shell. On Pretoria 3G a doomed request can hang for 30s+; showing the
 * shell and an honest offline banner beats a blank screen for half a minute.
 */
const NAVIGATION_TIMEOUT_MS = 3500

/** Bounds so caches cannot grow without limit on a 16 GB phone. */
const IMAGE_CACHE_LIMIT = 60
const ASSET_CACHE_LIMIT = 80

// ---------------------------------------------------------------------------
// install — fetch the shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)

      // NOT cache.addAll(): it is atomic, so a single 404 or a dropped packet
      // fails the whole install and the app ends up with no offline support at
      // all. Each entry is attempted independently instead — a partial shell is
      // far better than none.
      const results = await Promise.allSettled(
        SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      )

      const failed = SHELL_URLS.filter((_, i) => results[i].status === 'rejected')
      if (failed.length) {
        // Logged, not thrown: the browser would discard a partially-filled cache
        // if install rejected, which is the opposite of what we want.
        console.warn('[sw] shell entries that failed to precache:', failed)
      }
    })()
  )
})

// ---------------------------------------------------------------------------
// activate — purge leftovers from older versions
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => !OWNED_CACHES.includes(name))
          .map((name) => caches.delete(name))
      )

      // Take over the NEXT navigation, not the one in progress. (See note 2.)
      if (self.registration.navigationPreload) {
        // Let the browser start the navigation request while we boot, so the
        // network-first path is not slowed down by the worker starting up.
        await self.registration.navigationPreload.enable()
      }
    })()
  )
})

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only GET is cacheable. Crucially, writes are NOT intercepted: a POST that
  // the worker swallowed would look to the app like a delivered request. Offline
  // writes are the queue's job, where they can be durably recorded and replayed.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Cross-origin (map tiles, fonts on other domains) passes through untouched.
  if (url.origin !== self.location.origin) return

  // Supabase must never be cached. See note 1.
  // The check is on the path because the project URL is configured at build time
  // (`VITE_SUPABASE_URL`) and is not available inside the worker. These prefixes
  // are the PostgREST, GoTrue and Edge Function endpoints respectively.
  if (
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/realtime/') ||
    url.pathname.startsWith('/storage/v1/')
  ) {
    return
  }

  if (request.mode === 'navigate') {
    // The event, not just the request: navigation preload hands us a promise
    // that is only reachable from the event.
    event.respondWith(handleNavigation(event))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE, ASSET_CACHE_LIMIT))
    return
  }

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, IMAGE_CACHE_LIMIT))
    return
  }

  // Everything else same-origin: try the network, fall back to cache. Nothing
  // unknown is written to a cache — an allowlist keeps PII-bearing URLs out by
  // default rather than by remembering to exclude them.
  event.respondWith(networkFallingBackToCache(request, SHELL_CACHE))
})

// ---------------------------------------------------------------------------
// strategies
// ---------------------------------------------------------------------------

/**
 * Network-first with a timeout, then the cached shell, then the offline page.
 *
 * Network-first (rather than cache-first) so a deploy is picked up on the next
 * load: index.html is not content-hashed, so a cached copy would pin users to a
 * stale build and its hashed asset URLs.
 */
async function handleNavigation(event) {
  const cache = await caches.open(SHELL_CACHE)

  try {
    // With navigation preload enabled the browser has ALREADY started this
    // request in parallel with the worker booting, so awaiting it costs nothing
    // extra. Without it we start the request ourselves.
    let response = null

    if (event.preloadResponse) {
      response = await withTimeout(event.preloadResponse, NAVIGATION_TIMEOUT_MS).catch(
        () => null
      )
    }
    if (!response) {
      response = await withTimeout(fetch(event.request), NAVIGATION_TIMEOUT_MS)
    }

    if (response && response.ok) {
      // Refresh the stored shell so the next cold start is current.
      cache.put('/', response.clone()).catch(() => {})
      return response
    }
    throw new Error(`navigation responded ${response ? response.status : 'nothing'}`)
  } catch {
    // Offline, or the network is slower than a rider is willing to wait.
    const cachedShell = await cache.match('/')
    if (cachedShell) return cachedShell

    const offline = await cache.match('/offline.html')
    if (offline) return offline

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<body style="font:16px system-ui;padding:2rem">You are offline and the ' +
        'app has not been saved for offline use yet. Reconnect and open ROMA once ' +
        'more.</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}

/** Hashed filenames are immutable, so a hit can never be stale. */
async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit

  const response = await fetch(request)
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {})
    trimCache(cacheName, limit)
  }
  return response
}

/** Show the cached copy immediately, refresh in the background. */
async function staleWhileRevalidate(request, cacheName, limit) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {})
        trimCache(cacheName, limit)
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    // Deliberately not awaited: the caller gets the cached bytes now, not later.
    return cached
  }

  const response = await network
  if (response) return response

  return new Response('', { status: 504, statusText: 'Offline' })
}

async function networkFallingBackToCache(request, cacheName) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(cacheName)
    const hit = await cache.match(request)
    if (hit) return hit
    return new Response('', { status: 504, statusText: 'Offline' })
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

/**
 * Keep a cache under `limit` entries.
 *
 * Cache API keys are returned in insertion order, so dropping from the front
 * evicts the oldest. Crude next to a real LRU, but it bounds growth, which is
 * the point on a phone with limited storage.
 */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)))
}

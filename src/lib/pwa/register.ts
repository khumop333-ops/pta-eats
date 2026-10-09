/**
 * Service-worker registration.
 *
 * Kept out of index.html on purpose. An inline registration script would be
 * Vite-shaped, whereas a module in src/ is invoked from the app entry point and
 * behaves identically once this project moves to another bundler or framework.
 *
 * The worker file itself also lives at the site root (/public/sw.js) so its scope
 * is the whole origin — required for it to control navigations anywhere in the
 * SPA, and the same arrangement works for any static host.
 */

export type ServiceWorkerStatus =
  | 'unsupported'
  | 'registered'
  | 'failed'
  | 'skipped-dev'

export function registerServiceWorker(): ServiceWorkerStatus {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }

  // A service worker in development is actively harmful: it caches the shell,
  // so edits appear not to take effect and HMR fights a stale HTML document.
  // import.meta.env is Vite's shape; the guard is written so a non-Vite bundler
  // simply treats the value as undefined and registers normally in production.
  const isDev =
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
  if (isDev) return 'skipped-dev'

  // Registered after `load` so the worker never competes with the first paint
  // for bandwidth — on a 3G connection those first kilobytes matter.
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        // Never let the HTTP cache satisfy the worker script itself. A cached
        // worker can pin an installed app to a stale version indefinitely, and
        // this is the one file whose freshness we cannot reason about from
        // inside the app.
        updateViaCache: 'none',
      })
      .catch((error) => {
        // Registration failure is not fatal: the app runs exactly as it did
        // before, just without offline support.
        console.warn('[pwa] service worker registration failed', error)
      })
  }

  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register, { once: true })
  }

  return 'registered'
}

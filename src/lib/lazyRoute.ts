import { lazy, type ComponentType } from "react";

const RELOAD_FLAG = "roma-chunk-reload";

/**
 * React.lazy with one recovery step for stale deploys.
 *
 * Every merge to main ships new hashed chunk filenames to Vercel. A tab that
 * loaded the previous build will 404 when it later lazy-loads a route (e.g.
 * tapping "Checkout"), so we reload the page once to pick up the new build.
 * The sessionStorage flag prevents a reload loop if the chunk is genuinely
 * unavailable (offline, bad deploy) — in that case the error propagates.
 */
export function lazyRoute<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const module = await importer();
      safeSession(() => window.sessionStorage.removeItem(RELOAD_FLAG));
      return module;
    } catch (error) {
      const alreadyReloaded = safeSession(() => window.sessionStorage.getItem(RELOAD_FLAG));
      if (!alreadyReloaded && typeof window !== "undefined") {
        safeSession(() => window.sessionStorage.setItem(RELOAD_FLAG, "1"));
        window.location.reload();
        // Keep Suspense showing its fallback while the page reloads.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

function safeSession<R>(fn: () => R): R | undefined {
  try {
    return fn();
  } catch {
    // Private mode / storage disabled — skip the guard rather than crash.
    return undefined;
  }
}

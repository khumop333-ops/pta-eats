/**
 * Shown while a lazily-loaded route chunk downloads. Deliberately tiny (no
 * images, no data) so it paints instantly even on a slow mobile connection.
 */
const RouteFallback = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="roma-surface flex min-h-screen flex-col items-center justify-center gap-4 px-4"
  >
    <span
      aria-hidden="true"
      className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary motion-reduce:animate-none"
    />
    <p className="font-display text-lg font-semibold text-foreground">Roma</p>
    <span className="sr-only">Loading page…</span>
  </div>
);

export default RouteFallback;

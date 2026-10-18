const DEFAULT_AUTH_RETURN_PATH = "/";

/** Return to an internal route after sign-in, rejecting external redirect targets. */
export function getAuthReturnPath(state: unknown): string {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return DEFAULT_AUTH_RETURN_PATH;
  }

  const from = (state as { from?: unknown }).from;
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) {
    return DEFAULT_AUTH_RETURN_PATH;
  }

  return from;
}

/**
 * Generic placeholder that shipped with the demo data. It is a real file that
 * loads fine, so the storefront has to treat it as "no photography".
 */
const LEGACY_PLACEHOLDER = "/placeholder.svg";

/** True only when we have something worth rendering as a photo. */
export function isUsableImageSrc(src?: string | null): boolean {
  const trimmed = src?.trim() ?? "";
  return trimmed.length > 0 && trimmed !== LEGACY_PLACEHOLDER;
}

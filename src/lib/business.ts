// Roma business rules — single source of truth on the frontend.
// Keep DELIVERY_FEE and MAGWINYA_ZONE_DELIVERY_FEE in sync with
// supabase/functions/create-order (Edge Functions cannot import from src/).
// No minimum order amount (business decision, Oct 2026).

export const DELIVERY_FEE = 20; // Default delivery fee in Rand
export const MAGWINYA_ZONE_SLUG = "magwinya-zone";
export const MAGWINYA_ZONE_DELIVERY_FEE = 15; // Magwinya Zone delivery fee in Rand
export const CURRENCY_SYMBOL = "R";

export function getRestaurantDeliveryFee(options?: {
  slug?: string | null;
  name?: string | null;
  deliveryFee?: number | string | null;
}): number {
  const rawFee = options?.deliveryFee;
  if (rawFee !== undefined && rawFee !== null && rawFee !== "") {
    const parsed = typeof rawFee === "number" ? rawFee : Number(rawFee);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const normalizedSlug = options?.slug?.trim().toLowerCase();
  const normalizedName = options?.name?.trim().toLowerCase();
  if (normalizedSlug === MAGWINYA_ZONE_SLUG || normalizedName === "magwinya zone") {
    return MAGWINYA_ZONE_DELIVERY_FEE;
  }

  return DELIVERY_FEE;
}

// Ordering hours: 08:00–18:00, every day, South Africa time.
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 18;
export const BUSINESS_TIMEZONE = "Africa/Johannesburg";
export const OPENING_HOURS_LABEL = "08:00–18:00 daily";

function JohannesburgNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: BUSINESS_TIMEZONE }));
}

export function isOpenNow(now: Date = JohannesburgNow()): boolean {
  const hour = now.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

export const PREORDER_MESSAGE = `Roma is currently closed (${OPENING_HOURS_LABEL}). You can send a pre-order now; Roma will confirm availability and delivery after reopening.`;

export const CLOSED_MESSAGE = `Roma is closed — ordering is open ${OPENING_HOURS_LABEL}. Please come back during opening hours.`;

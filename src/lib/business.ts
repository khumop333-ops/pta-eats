// Roma business rules — single source of truth on the frontend.
// Keep DELIVERY_FEE in sync with supabase/functions/create-order (Edge Functions
// cannot import from src/). No minimum order amount (business decision, Oct 2026).

export const DELIVERY_FEE = 20; // Rand
export const CURRENCY_SYMBOL = "R";

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

export const CLOSED_MESSAGE = `Roma is closed — ordering is open ${OPENING_HOURS_LABEL}. Please come back during opening hours.`;

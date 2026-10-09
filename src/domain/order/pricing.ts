/**
 * ROMA pricing — client-side types and formatting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLIENT NEVER COMPUTES MONEY. IT ONLY RENDERS A SERVER QUOTE.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every amount here arrives pre-calculated from `public.quote_order()` in
 * supabase/migrations/20261005140000_pricing_and_service_window.sql. This module
 * deliberately contains NO arithmetic on prices — no subtotal(), no
 * multiplication, no fee addition. That absence is the design.
 *
 * It previously did, and it went wrong in the obvious way: `Checkout.tsx` held
 * `const DELIVERY_FEE = 15` while `create-order` held its own `DELIVERY_FEE = 15`
 * and the database held a third copy as a column default. Three implementations
 * of one number. They agreed by luck. The moment zone-based pricing landed, the
 * displayed total and the charged total would have diverged — and the customer
 * would discover it on their bank statement.
 *
 * The only functions permitted here are pure presentation: formatting cents as
 * rands, and labelling the service window. Those cannot disagree with the server
 * because they carry no pricing opinion.
 *
 * Money is INTEGER CENTS throughout. Floats are never used for currency.
 */

/** A single priced line, as returned by `quote_order()`. */
export interface QuoteLine {
  menuItemId: string
  name: string
  unitPriceCents: number
  quantity: number
  lineTotalCents: number
  restaurantId: number
  restaurantName: string
}

/** Service-window state, mirroring `public.service_availability()`. */
export interface ServiceAvailability {
  isOpen: boolean
  canOrder: boolean
  reason: 'open' | 'closed' | 'closed_but_accepting' | 'config_missing'
  /** ISO timestamps, or null when unknown. */
  opensAt: string | null
  closesAt: string | null
  nextOpenAt: string | null
  openTime?: string
  closeTime?: string
  openDays?: number[]
  timezone: string
}

/** A successful quote. `ok` discriminates the union below. */
export interface OrderQuote {
  ok: true
  items: QuoteLine[]
  subtotalCents: number
  deliveryFeeCents: number
  totalCents: number
  zone: string
  zoneLabel: string
  restaurantId: number
  service: ServiceAvailability
  canPlaceOrder: boolean
}

/** Failure reasons `quote_order()` can return. */
export type QuoteErrorCode =
  | 'empty_basket'
  | 'basket_too_large'
  | 'unknown_zone'
  | 'invalid_item'
  | 'item_unavailable'
  | 'mixed_restaurants'

export interface QuoteFailure {
  ok: false
  error: QuoteErrorCode
  zone?: string
}

export type QuoteResult = OrderQuote | QuoteFailure

/**
 * Operator-facing copy for each failure. Kept as a total Record so adding a new
 * error code to the database produces a compile error here rather than a blank
 * toast in production.
 */
export const QUOTE_ERROR_MESSAGE: Record<QuoteErrorCode, string> = {
  empty_basket: 'Your basket is empty.',
  basket_too_large: 'That is too many items for one order. Please split it.',
  unknown_zone: "We don't deliver to that area yet.",
  invalid_item: "Something in your basket isn't right. Please remove it and try again.",
  item_unavailable: 'An item in your basket is no longer available.',
  mixed_restaurants: 'An order can only come from one restaurant.',
}

export function quoteErrorMessage(failure: QuoteFailure): string {
  return QUOTE_ERROR_MESSAGE[failure.error] ?? 'We could not price your basket.'
}

/**
 * Format integer cents as South African rands, e.g. 12345 -> "R 123,45".
 *
 * Uses a comma decimal separator, which is the South African convention and what
 * the rest of the UI already assumes via `toLocaleString('en-ZA')`. Note the
 * previous screens used `R {x.toFixed(2)}` — a PERIOD. That is the en-US form and
 * reads as a thousands separator to a South African customer, so "R 1.50" could
 * be misread as fifteen hundred rand.
 */
export function formatZAR(cents: number): string {
  if (!Number.isFinite(cents)) return 'R —'
  const negative = cents < 0
  const abs = Math.abs(Math.round(cents))
  const rands = Math.floor(abs / 100)
  const remainder = abs % 100
  const grouped = rands.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${negative ? '-' : ''}R ${grouped},${remainder.toString().padStart(2, '0')}`
}

/** ISO day-of-week numbers to short names, for rendering opening hours. */
const DAY_NAMES: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
  5: 'Friday', 6: 'Saturday', 7: 'Sunday',
}

/** e.g. [1,2,3,4,5] -> "Monday to Friday" */
export function describeOpenDays(days: number[] | undefined): string {
  if (!days || days.length === 0) return 'Closed'
  if (days.length === 7) return 'Every day'

  const sorted = [...days].sort((a, b) => a - b)
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)

  if (consecutive && sorted.length > 2) {
    return `${DAY_NAMES[sorted[0]]} to ${DAY_NAMES[sorted[sorted.length - 1]]}`
  }
  return sorted.map((d) => DAY_NAMES[d] ?? String(d)).join(', ')
}

/**
 * A short sentence explaining a closed storefront, e.g.
 * "We're closed. Next delivery slot: Monday 08:00."
 *
 * Returns null when ordering is possible, so callers can render
 * `{message && <Banner/>}` without branching on availability themselves.
 */
export function closedMessage(service: ServiceAvailability): string | null {
  if (service.canOrder) return null

  const next = service.nextOpenAt ? new Date(service.nextOpenAt) : null
  const valid = next && !Number.isNaN(next.getTime())

  if (!valid) {
    // Still give the customer the rule, even if we cannot compute the moment.
    const days = describeOpenDays(service.openDays)
    return `We're closed. Deliveries run ${days}, ${service.openTime ?? '08:00'}–${service.closeTime ?? '16:00'}.`
  }

  // Render in the BUSINESS timezone, not the device's. `nextOpenAt` is an
  // absolute instant; without an explicit timeZone, toLocaleString uses whatever
  // the customer's device is set to, so a traveller or a phone with the wrong
  // timezone would be told the wrong opening hour. Opening hours belong to the
  // shop, not the handset. This was caught by a test asserting 08:00 that
  // received 06:00.
  const when = next.toLocaleString('en-ZA', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: service.timezone || 'Africa/Johannesburg',
  })
  return `We're closed right now. Order from ${when}.`
}

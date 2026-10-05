/**
 * ROMA order status — canonical vocabulary.
 *
 * This module is the client-side mirror of the database's
 * `public.order_status_transitions` table and the `orders_status_check`
 * constraint (see supabase/migrations/20261005120000_dispatch_core.sql).
 *
 * WHY THIS EXISTS: before the dispatch migration, six loose string literals
 * ('New', 'Accepted', 'Preparing', 'Ready', 'Picked Up', 'Delivered') were
 * scattered across three dashboards, and OwnerDashboard additionally referenced
 * 'On the Way' — a status that has never existed in the database. Nothing caught
 * any of it, because the values were untyped strings.
 *
 * DESIGN RULE: this file is pure. No React, no Supabase, no side effects. The
 * rules that decide whether an order may move are unit-testable without mocking
 * anything, which is the whole point — these are the rules that cost money when
 * they are wrong.
 *
 * The database remains the authority. These guards exist to give the UI honest
 * affordances (do not render an Accept button that will be rejected); they are
 * NOT a security control. Every transition is re-validated server-side by
 * `transition_order_status()`.
 */

/** The complete, closed set of order statuses. Mirrors `orders_status_check`. */
export const ORDER_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
  'delivered',
  'cancelled',
  'failed',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Who is acting. Mirrors the `actor` column of `order_status_transitions`. */
export type OrderActor = 'customer' | 'vendor' | 'deliverer' | 'system'

/**
 * Legal transitions, keyed by `${from}->${to}`.
 *
 * Kept as a flat Set for O(1) lookup. `TRANSITIONS` below is the readable
 * source of truth; this is its index.
 */
const TRANSITION_TABLE: ReadonlyArray<readonly [OrderStatus, OrderStatus, OrderActor]> = [
  ['pending', 'accepted', 'vendor'],
  ['pending', 'cancelled', 'customer'],
  ['pending', 'cancelled', 'system'],

  ['accepted', 'preparing', 'vendor'],
  ['accepted', 'cancelled', 'vendor'],
  ['accepted', 'cancelled', 'customer'],

  ['preparing', 'ready', 'vendor'],
  ['preparing', 'cancelled', 'vendor'],

  ['ready', 'assigned', 'deliverer'],
  ['ready', 'cancelled', 'vendor'],
  ['ready', 'cancelled', 'system'],

  ['assigned', 'picked_up', 'deliverer'],
  ['assigned', 'ready', 'deliverer'],
  ['assigned', 'failed', 'deliverer'],
  ['assigned', 'failed', 'system'],

  ['picked_up', 'delivered', 'deliverer'],
  ['picked_up', 'failed', 'deliverer'],
  ['picked_up', 'failed', 'system'],
] as const

export const TRANSITIONS = TRANSITION_TABLE

// O(1) lookup index, built once at module load.
const LEGAL = new Set(TRANSITION_TABLE.map(([from, to, actor]) => `${from}->${to}:${actor}`))
const LEGAL_PAIR = new Set(TRANSITION_TABLE.map(([from, to]) => `${from}->${to}`))

/** Terminal states from which no further transition is possible. */
export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'delivered',
  'cancelled',
  'failed',
])

/**
 * Narrow an arbitrary string (e.g. a raw database value) to OrderStatus.
 *
 * Use this at every trust boundary — Supabase rows are `string` in the generated
 * types, so this is where the untyped world becomes typed.
 */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

/**
 * Assert a database value is a known status.
 *
 * Deliberately throws rather than coercing. A silent fallback here is how the
 * previous 'On the Way' phantom status survived unnoticed — an unknown value
 * should be loud, not quietly rendered as "unknown".
 */
export function assertOrderStatus(value: unknown, context = 'order'): OrderStatus {
  if (!isOrderStatus(value)) {
    throw new Error(
      `Unknown ${context} status: ${JSON.stringify(value)}. ` +
        `Expected one of: ${ORDER_STATUSES.join(', ')}. ` +
        `If this came from the database, the client and schema are out of sync.`
    )
  }
  return value
}

/** May `to` ever follow `from`, for any actor? Drives transition-graph UI. */
export function isLegalPair(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_PAIR.has(`${from}->${to}`)
}

/** May `actor` move this order from `from` to `to`? */
export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return LEGAL.has(`${from}->${to}:${actor}`)
}

/** Every status `actor` may move to from `from`. Drives button lists. */
export function nextStatusesFor(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return TRANSITION_TABLE.filter(([f, , a]) => f === from && a === actor).map(([, to]) => to)
}

/**
 * Statuses considered "in progress" — i.e. the order exists and is not yet
 * resolved. Replaces the previous `status !== 'Delivered'` checks, which
 * incorrectly counted cancelled and failed orders as active.
 */
export function isActive(status: OrderStatus): boolean {
  return !TERMINAL_STATUSES.has(status)
}

/** Human-readable label. Kept here so no component invents its own wording. */
const LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  assigned: 'Driver assigned',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

export function statusLabel(status: OrderStatus): string {
  return LABELS[status]
}

/** Presentation variants for the Badge primitive. */
export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger'

const TONES: Record<OrderStatus, StatusTone> = {
  pending: 'neutral',
  accepted: 'info',
  preparing: 'progress',
  ready: 'info',
  assigned: 'progress',
  picked_up: 'progress',
  delivered: 'success',
  cancelled: 'danger',
  failed: 'danger',
}

export function statusTone(status: OrderStatus): StatusTone {
  return TONES[status]
}

/**
 * Imperative label for the control that MOVES an order into `to`.
 * Shared by all three dashboards so the same transition is never called two
 * different things (previously "Ready", "Ready for Pickup/Delivery" and
 * "On the Way" all meant different things in different files, and two of those
 * values did not exist in the database at all).
 */
const ACTIONS: Partial<Record<OrderStatus, string>> = {
  pending: 'Release to board',
  accepted: 'Accept order',
  preparing: 'Start preparing',
  ready: 'Mark ready',
  assigned: 'Claim job',
  picked_up: 'Confirm pickup',
  delivered: 'Confirm delivery',
  cancelled: 'Cancel order',
  failed: 'Report a problem',
}

export function actionLabel(to: OrderStatus): string {
  return ACTIONS[to] ?? statusLabel(to)
}

/** Tailwind classes per tone. Presentation lives in the UI layer, not the domain. */
export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  progress: 'bg-orange-100 text-orange-800 border-orange-200',
  success: 'bg-green-100 text-green-800 border-green-200',
  danger: 'bg-destructive/10 text-destructive border-destructive/30',
}

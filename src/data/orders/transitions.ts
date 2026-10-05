/**
 * Order transition data layer.
 *
 * Every order-state change in ROMA goes through this module. The three
 * dashboards previously each did `supabase.from('orders').update({ status })`
 * directly, which bypassed the state machine and let any actor write any status
 * string. Routing through the database RPC means the transitions table — not
 * the UI — decides what is legal.
 *
 * The RPCs are SECURITY DEFINER and re-check the caller's role and the service
 * window server-side, so nothing here is a security control. This layer exists
 * to (a) centralise the call and (b) translate Postgres error codes into
 * something a rider on a 3G connection can actually act on.
 */
import { supabase } from '@/integrations/supabase/client'
import type { OrderStatus } from '@/domain/order/status'
import type { QuoteResult, ServiceAvailability } from '@/domain/order/pricing'

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string }

/**
 * Postgres error code -> operator-facing copy.
 *
 * The database raises these deliberately distinguishable codes (see
 * transition_order_status in 20261005120000_dispatch_core.sql); conflating them
 * makes a production incident much harder to diagnose. Order matters: the first
 * matching substring wins.
 */
const EXPLANATIONS: ReadonlyArray<readonly [string, string]> = [
  ['outside_service_window', 'Deliveries run 08:00–16:00, Monday to Friday.'],
  ['not_a_deliverer', "This account isn't set up as a delivery rider."],
  ['order_unavailable', 'Another rider just took this job.'],
  ['not_your_order', "That delivery isn't assigned to you."],
  ['actor_not_permitted', "You don't have permission to make that change."],
  ['illegal_transition', "That step isn't possible from the order's current stage."],
  ['order_not_found', 'That order no longer exists.'],
  ['not_authenticated', 'Your session has expired. Please sign in again.'],
]

function explain(rawMessage: string): string {
  const match = EXPLANATIONS.find(([code]) => rawMessage.includes(code))
  return match ? match[1] : "Couldn't update the order. Check your connection and try again."
}

/** Move an order to `to`, or explain why that isn't allowed. */
export async function transitionOrderStatus(
  orderId: string,
  to: OrderStatus
): Promise<ActionResult> {
  const { error } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_to: to,
  })

  if (!error) return { ok: true }
  return { ok: false, message: explain(error.message ?? '') }
}

/**
 * Claim a ready order. Atomic server-side via FOR UPDATE SKIP LOCKED, so two
 * riders tapping at once means exactly one wins.
 */
export async function claimOrder(orderId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc('claim_order', { p_order_id: orderId })

  if (!error) return { ok: true }
  return { ok: false, message: explain(error.message ?? '') }
}

/** A job as a rider sees it before accepting: no customer PII. */
export interface OpenJob {
  id: string
  restaurant_name: string
  pickup_suburb: string
  dropoff_suburb: string
  fee_cents: number
  zone: string
  created_at: string
  age_seconds: number
}

/**
 * The redacted job board. Returns nothing for non-riders — the RPC filters on
 * has_role(...,'deliverer') rather than trusting the UI to hide it.
 */
export async function listOpenJobs(): Promise<OpenJob[]> {
  const { data, error } = await supabase.rpc('list_open_jobs')
  if (error || !data) return []
  return data as OpenJob[]
}

/**
 * Fetch the authoritative quote for a basket.
 *
 * This is the ONLY way the UI learns what an order costs. The client sends WHAT it
 * wants; the database decides what it costs. The same function prices the order at
 * placement, so the figure on this screen is the figure that gets charged.
 */
export async function quoteOrder(
  items: ReadonlyArray<{ menuItemId: string; quantity: number }>,
  zone?: string | null
): Promise<QuoteResult> {
  if (items.length === 0) return { ok: false, error: 'empty_basket' }

  const { data, error } = await supabase.rpc('quote_order', {
    p_items: items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
    p_zone: zone ?? null,
  })

  if (error || !data) {
    // A transport failure is not a pricing answer — surface it as a generic
    // failure rather than pretending the basket is empty or unavailable.
    return { ok: false, error: 'item_unavailable' }
  }
  return data as unknown as QuoteResult
}

/** Service-window state, for rendering closed banners and opening hours. */
export async function fetchServiceAvailability(): Promise<ServiceAvailability | null> {
  const { data, error } = await supabase.rpc('service_availability')
  if (error || !data) return null
  return data as unknown as ServiceAvailability
}

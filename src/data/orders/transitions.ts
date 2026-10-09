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
import { isOrderStatus, type OrderStatus } from '@/domain/order/status'
import type {
  ClaimOutcome,
  TransitionOutcome,
} from '@/domain/order/transition'
import type { QuoteResult, ServiceAvailability } from '@/domain/order/pricing'

// Re-exported so existing call sites can keep importing the outcome types from
// the data layer they already use. The single definition lives in the domain.
export type { ClaimOutcome, TransitionOutcome } from '@/domain/order/transition'

/**
 * The jsonb envelopes returned by the RPCs.
 *
 * `unknown` for the order body is deliberate: this is untrusted wire data and the
 * only field this layer is entitled to interpret is the status, which it narrows
 * with isOrderStatus().
 */
interface TransitionEnvelope {
  ok: boolean
  alreadyApplied?: boolean
  error?: string
  currentStatus?: unknown
  expectedFrom?: unknown
  order?: unknown
}

interface ClaimEnvelope {
  ok: boolean
  alreadyClaimed?: boolean
  error?: string
  order?: unknown
}

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

/**
 * Narrow a status arriving from the database.
 *
 * Returns null rather than throwing: this value is only ever used to TELL the
 * user where the order is. Refusing to render a reconciliation because the
 * database reported a status this build does not know about would turn a
 * cosmetic version skew into a hard failure — exactly what an offline queue must
 * not do.
 */
function narrowStatus(value: unknown): OrderStatus | null {
  return isOrderStatus(value) ? value : null
}

/**
 * Did this error come from the server, or did the request never arrive?
 *
 * PostgREST returns a SQLSTATE in `code` whenever the database answered — a
 * permission error, a constraint violation, a RAISE from our own functions.
 * A transport failure has no SQLSTATE to report.
 *
 * When the shape is ambiguous this deliberately errs towards `offline`, and the
 * asymmetry is the reason: mistaking a server error for a transport error costs
 * a few pointless retries, which the attempt cap and backoff contain. Mistaking
 * a transport error for a server error DELETES a write the rider believes is
 * safe. Only one of those loses a delivery.
 *
 * Worth re-verifying against the live project, since supabase-js has changed how
 * it wraps fetch failures between versions: a timeout should not read as a
 * refusal.
 */
function isTransportFailure(error: { code?: string | null } | null): boolean {
  if (!error) return false
  return !error.code
}

/**
 * Move an order to `to`.
 *
 * `expectedFrom` is the status the CALLER believes the order is in — normally the
 * one it rendered. Pass it and the database performs a compare-and-swap: the
 * update only applies if the order is still there, so a stale view cannot
 * silently overwrite a change made elsewhere. Pass `null` to have the server
 * validate against the order's current state instead (the strict path).
 *
 * The parameter is required and explicitly nullable so that every call site
 * states which of the two it means. A defaulted parameter here would let the
 * queue silently fall back to the weaker check.
 *
 * Never throws for an expected condition. A returned `conflict` is a normal
 * outcome of an offline queue draining against a world that moved on.
 */
export async function transitionOrderStatus(
  orderId: string,
  to: OrderStatus,
  expectedFrom: OrderStatus | null
): Promise<TransitionOutcome> {
  const { data, error } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_to: to,
    // Sent as an explicit null rather than omitted: the SQL treats NULL as the
    // strict path, and being explicit keeps the wire payload shape stable.
    p_expected_from: expectedFrom,
  })

  if (error) {
    if (isTransportFailure(error)) return { ok: false, kind: 'offline' }
    return { ok: false, kind: 'refused', message: explain(error.message ?? '') }
  }

  const envelope = data as unknown as TransitionEnvelope | null
  if (!envelope) {
    // A 200 with an unparseable body. Treated as a refusal rather than offline:
    // the request clearly reached SOMETHING, so retrying blindly could loop.
    return { ok: false, kind: 'refused', message: explain('') }
  }

  if (envelope.ok) {
    return { ok: true, alreadyApplied: envelope.alreadyApplied === true }
  }

  // ok:false with error:'conflict' is the compare-and-swap miss. Anything else
  // (or a malformed envelope) is treated as a refusal so it is never silently
  // swallowed by the queue as "already done".
  if (envelope.error === 'conflict') {
    return {
      ok: false,
      kind: 'conflict',
      currentStatus: narrowStatus(envelope.currentStatus),
      expectedFrom: narrowStatus(envelope.expectedFrom),
    }
  }

  return { ok: false, kind: 'refused', message: explain(envelope.error ?? '') }
}

/**
 * Claim a ready order.
 *
 * Atomic server-side via FOR UPDATE SKIP LOCKED, so two riders tapping at once
 * means exactly one wins. Replay-safe: a rider whose acknowledgement was lost
 * gets `alreadyClaimed: true` instead of "another rider just took this job",
 * which would make them abandon a delivery that is genuinely theirs.
 */
export async function claimOrder(orderId: string): Promise<ClaimOutcome> {
  const { data, error } = await supabase.rpc('claim_order', { p_order_id: orderId })

  if (error) {
    if (isTransportFailure(error)) return { ok: false, kind: 'offline' }
    return { ok: false, kind: 'refused', message: explain(error.message ?? '') }
  }

  const envelope = data as unknown as ClaimEnvelope | null
  if (envelope?.ok) return { ok: true, alreadyClaimed: envelope.alreadyClaimed === true }

  return { ok: false, kind: 'refused', message: explain(envelope?.error ?? '') }
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

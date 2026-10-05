/**
 * Order-transition outcomes and their operator-facing interpretation.
 *
 * Pure. No I/O, no network, no Postgres knowledge — just the vocabulary for
 * "what happened when we tried to move an order" and how to phrase it.
 *
 * It lives in the domain layer rather than next to the RPC wrapper on purpose:
 * the data layer (src/data/orders/transitions.ts) PARSES the RPC envelopes into
 * these types. If the types lived in the data layer, this module would have to
 * import from it, inverting the dependency — domain logic would depend on the
 * transport. Keeping them here means the data layer depends on the domain, and
 * this file stays unit-testable without a database.
 */
import { statusLabel, type OrderStatus } from './status'

/**
 * The result of attempting a status change.
 *
 * The distinction between `alreadyApplied` and `conflict` is the entire reason
 * this type exists. An offline queue has to be able to tell three things apart:
 *
 *   1. The change landed now                     -> ok, alreadyApplied: false
 *   2. The change landed EARLIER (ack was lost)  -> ok, alreadyApplied: true
 *   3. The order is not where we thought         -> conflict, with currentStatus
 *
 * Collapsing (2) into an error is the defect that made an offline queue
 * impossible: a rider whose success acknowledgement was dropped would be told
 * their completed delivery was an illegal transition.
 *
 * `offline` is a fourth case and is NOT the same as `refused`. It means the
 * request never reached the server, so we do not know whether it applied —
 * which is precisely the situation compare-and-swap makes safe to retry. A
 * `refused` means the server answered and said no, where retrying is futile.
 * The queue treats those two in opposite ways, so conflating them either loses
 * writes or retries them forever.
 */
export type TransitionOutcome =
  | { ok: true; alreadyApplied: boolean }
  | {
      ok: false
      kind: 'conflict'
      /** Where the order actually is, or null if the server reported something unrecognised. */
      currentStatus: OrderStatus | null
      /** What the caller asserted, echoed back for reconciliation. */
      expectedFrom: OrderStatus | null
    }
  | { ok: false; kind: 'offline' }
  | { ok: false; kind: 'refused'; message: string }

/** Claiming is idempotent, so a lost acknowledgement can never read as a lost job. */
export type ClaimOutcome =
  | { ok: true; alreadyClaimed: boolean }
  | { ok: false; kind: 'offline' }
  | { ok: false; kind: 'refused'; message: string }

export type FeedbackTone = 'success' | 'info' | 'warning' | 'error'

export interface TransitionFeedback {
  tone: FeedbackTone
  message: string
  /**
   * Whether the caller should re-read the order. True for a conflict — the local
   * view is known to be wrong — and never true for a plain success, where
   * refetching would discard a correct optimistic update for no reason.
   */
  refresh: boolean
  /** Whether the order is now (or already was) in the requested state. */
  applied: boolean
}

/**
 * Turn an outcome into something a human can read and act on.
 *
 * Deliberately pure and exported: the conflict wording is part of the offline
 * contract, so it is asserted in tests rather than eyeballed in three separate
 * dashboards. Three copies of this logic would drift.
 *
 * `label` is injectable so tests do not depend on presentation copy.
 */
export function describeTransition(
  result: TransitionOutcome,
  to: OrderStatus,
  label: (status: OrderStatus) => string = statusLabel
): TransitionFeedback {
  if (result.ok) {
    // A replay is informational, not a triumph: nothing changed just now. Showing
    // a green "done!" for an action that happened earlier trains operators to
    // distrust the toast, because the row never moved.
    return result.alreadyApplied
      ? { tone: 'info', message: `Already marked ${label(to).toLowerCase()}.`, refresh: false, applied: true }
      : { tone: 'success', message: `Marked ${label(to).toLowerCase()}.`, refresh: false, applied: true }
  }

  if (result.kind === 'conflict') {
    // The order moved while this screen was stale. Say where it went and pull the
    // truth down — do NOT report a failure, because nothing failed.
    return {
      tone: 'warning',
      message: result.currentStatus
        ? `Order moved on — it is now ${label(result.currentStatus).toLowerCase()}. Refreshed.`
        : 'This order changed elsewhere. Refreshed.',
      refresh: true,
      applied: false,
    }
  }

  if (result.kind === 'offline') {
    // Not the operator's fault and not a rejection. Say what is actually true:
    // the change is held and will be sent automatically. A rider who thinks a
    // tap was lost will tap again, which is how duplicates get created.
    return {
      tone: 'warning',
      message: 'No connection — this is saved and will send automatically.',
      refresh: false,
      applied: false,
    }
  }

  return { tone: 'error', message: result.message, refresh: false, applied: false }
}

/**
 * Claiming is deliberately NOT queueable, and this copy says so rather than
 * pretending the tap worked.
 *
 * A claim is an intent about the future: it competes with other riders for a job
 * that has to be collected now. Replaying it twenty minutes after a dropout would
 * hand a rider a delivery they can no longer make, and the customer would wait
 * for food nobody is collecting. A status change is the opposite — a record of
 * work already physically done — which is why only that is safe to defer.
 *
 * The distinction is not a limitation of the queue; it is the reason the queue is
 * trustworthy.
 */
export function describeClaim(result: ClaimOutcome): TransitionFeedback {
  if (result.ok) {
    return result.alreadyClaimed
      ? { tone: 'info', message: 'You had already claimed this job.', refresh: true, applied: true }
      : { tone: 'success', message: 'Job claimed.', refresh: true, applied: true }
  }

  if (result.kind === 'offline') {
    return {
      tone: 'warning',
      message: 'No connection — claiming a job needs a live link. Try again in a moment.',
      refresh: false,
      applied: false,
    }
  }

  return { tone: 'error', message: result.message, refresh: true, applied: false }
}

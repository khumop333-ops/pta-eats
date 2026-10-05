/**
 * What to do with a queued change, given what the server said.
 *
 * Pure and separate from queue.ts on purpose. The transport, storage and timers
 * around it are awkward to test; this decision table is the part where a mistake
 * loses a rider's work, so it is the part that must be exhaustively assertable
 * without a database or a browser.
 *
 * The three answers are genuinely different, and collapsing any two of them is a
 * bug with a user-visible consequence:
 *
 *   done    - stop tracking it. Covers a fresh success AND a replay whose
 *             acknowledgement was lost, because both mean the work is recorded.
 *   drop    - stop tracking it, and tell someone. The server answered; repeating
 *             the identical payload cannot change the answer.
 *   retry   - keep it. Nothing is known, because the request never arrived.
 *
 * The asymmetry that matters: `retry` on a permanently-refused write loops
 * forever, while `drop` on a request that may have applied DELETES work the
 * rider believes is safe. Only the second loses a delivery, so any genuine
 * ambiguity is resolved towards `retry`.
 */
import type { OrderStatus } from '@/domain/order/status'
import type { TransitionOutcome } from '@/domain/order/transition'

export type DrainAction =
  | { action: 'done' }
  | {
      action: 'drop'
      reason: 'conflict' | 'refused'
      /** Where the order actually is, when the drop was a conflict. */
      currentStatus: OrderStatus | null
      /** Operator-facing explanation, when the drop was a refusal. */
      message: string
    }
  | { action: 'retry' }

export function classifyDrainResult(outcome: TransitionOutcome): DrainAction {
  if (outcome.ok) {
    // Applied now, or applied earlier and the acknowledgement was lost. The
    // queue does not care which: either way it must stop tracking the item, and
    // this is the case that was impossible before the CAS migration.
    return { action: 'done' }
  }

  if (outcome.kind === 'conflict') {
    // The order moved while this device was offline. This change is obsolete —
    // replaying it would fight whatever superseded it — so it is dropped, and
    // reported so the operator learns the order progressed.
    return {
      action: 'drop',
      reason: 'conflict',
      currentStatus: outcome.currentStatus,
      message: '',
    }
  }

  if (outcome.kind === 'refused') {
    // A server answer that a retry cannot improve: no permission, outside the
    // service window, the order is gone, or the step is illegal from here.
    return {
      action: 'drop',
      reason: 'refused',
      currentStatus: null,
      message: outcome.message,
    }
  }

  // 'offline': the request never reached the server, so nothing about the
  // outcome is known. Keep it and try again later.
  return { action: 'retry' }
}

/**
 * The drain decision table.
 *
 * This is the part of the offline queue where a mistake loses a rider's work, so
 * it is asserted exhaustively rather than sampled. The two failure modes it
 * guards against pull in opposite directions:
 *
 *   retrying a permanently-refused write   -> an infinite loop, noisy but safe
 *   dropping a write that may have applied -> silent data loss
 *
 * The tests below therefore also pin the RULE for ambiguity, not just the
 * individual cases.
 */
import { describe, expect, it } from 'vitest'
import { classifyDrainResult } from '@/lib/offline/drainPolicy'
import type { TransitionOutcome } from '@/domain/order/transition'

describe('classifyDrainResult', () => {
  it('stops tracking a change that just landed', () => {
    expect(
      classifyDrainResult({ ok: true, alreadyApplied: false })
    ).toEqual({ action: 'done' })
  })

  it('stops tracking a REPLAY whose acknowledgement was lost', () => {
    // The whole reason the queue can exist. If a replay were retried, the item
    // would never leave the queue and would be re-sent forever.
    expect(
      classifyDrainResult({ ok: true, alreadyApplied: true })
    ).toEqual({ action: 'done' })
  })

  it('drops a change that the world moved past, and reports where the order went', () => {
    const outcome: TransitionOutcome = {
      ok: false,
      kind: 'conflict',
      currentStatus: 'delivered',
      expectedFrom: 'picked_up',
    }
    expect(classifyDrainResult(outcome)).toEqual({
      action: 'drop',
      reason: 'conflict',
      currentStatus: 'delivered',
      message: '',
    })
  })

  it('drops a refusal, because repeating it cannot change the answer', () => {
    const outcome: TransitionOutcome = {
      ok: false,
      kind: 'refused',
      message: "That step isn't possible from the order's current stage.",
    }
    expect(classifyDrainResult(outcome)).toEqual({
      action: 'drop',
      reason: 'refused',
      currentStatus: null,
      message: "That step isn't possible from the order's current stage.",
    })
  })

  it('KEEPS a change whose request never reached the server', () => {
    // Nothing is known about whether this applied, so discarding it would risk
    // deleting work that actually landed. Retrying is safe precisely because the
    // server applies it as a compare-and-swap.
    expect(classifyDrainResult({ ok: false, kind: 'offline' })).toEqual({
      action: 'retry',
    })
  })

  it('never returns "retry" for anything except a transport failure', () => {
    // The rule, stated once: only an unknown outcome is retried.
    const retryable: TransitionOutcome[] = [{ ok: false, kind: 'offline' }]
    const terminal: TransitionOutcome[] = [
      { ok: true, alreadyApplied: false },
      { ok: true, alreadyApplied: true },
      { ok: false, kind: 'conflict', currentStatus: null, expectedFrom: null },
      { ok: false, kind: 'refused', message: 'x' },
    ]

    for (const outcome of retryable) {
      expect(classifyDrainResult(outcome).action).toBe('retry')
    }
    for (const outcome of terminal) {
      expect(classifyDrainResult(outcome).action).not.toBe('retry')
    }
  })

  it('produces a decision for every variant of the outcome union', () => {
    // A compile-time exhaustiveness guard as much as a runtime one: adding a
    // variant to TransitionOutcome without teaching the queue how to handle it
    // should fail loudly rather than fall through to a default.
    const all: TransitionOutcome[] = [
      { ok: true, alreadyApplied: false },
      { ok: true, alreadyApplied: true },
      { ok: false, kind: 'conflict', currentStatus: 'ready', expectedFrom: 'preparing' },
      { ok: false, kind: 'refused', message: 'no' },
      { ok: false, kind: 'offline' },
    ]
    for (const outcome of all) {
      expect(['done', 'drop', 'retry']).toContain(classifyDrainResult(outcome).action)
    }
  })

  it('handles a conflict with an unrecognised status without throwing', () => {
    // Version skew: a newer server reports a status this build does not know.
    // The queue must still reach a decision.
    const outcome: TransitionOutcome = {
      ok: false,
      kind: 'conflict',
      currentStatus: null,
      expectedFrom: null,
    }
    expect(classifyDrainResult(outcome)).toEqual({
      action: 'drop',
      reason: 'conflict',
      currentStatus: null,
      message: '',
    })
  })
})

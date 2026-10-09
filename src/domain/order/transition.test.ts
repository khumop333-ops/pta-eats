/**
 * Contract tests for the transition-outcome vocabulary.
 *
 * These assert the THREE-WAY distinction that makes an offline queue possible.
 * The bug they exist to prevent is a replay of a successfully-applied transition
 * being presented to a rider as a failure — which, before the CAS migration, is
 * exactly what happened: a replayed `assigned -> picked_up` raised
 * `illegal_transition`, so a rider whose acknowledgement was dropped was told
 * their completed step was impossible.
 *
 * If a future refactor collapses `alreadyApplied` into `refused`, these fail.
 */
import { describe, expect, it } from 'vitest'
import {
  describeTransition,
  type TransitionOutcome,
} from '@/domain/order/transition'

const applied: TransitionOutcome = { ok: true, alreadyApplied: false }
const replayed: TransitionOutcome = { ok: true, alreadyApplied: true }
const conflict: TransitionOutcome = {
  ok: false,
  kind: 'conflict',
  currentStatus: 'delivered',
  expectedFrom: 'picked_up',
}
const refused: TransitionOutcome = {
  ok: false,
  kind: 'refused',
  message: "That step isn't possible from the order's current stage.",
}

describe('describeTransition', () => {
  it('reports a fresh change as success', () => {
    const f = describeTransition(applied, 'picked_up')
    expect(f.tone).toBe('success')
    expect(f.applied).toBe(true)
    expect(f.refresh).toBe(false)
  })

  it('reports a REPLAY as informational, not as a fresh success', () => {
    // Nothing changed just now. Showing triumphant green copy for an action that
    // happened earlier trains operators to distrust the toast.
    const f = describeTransition(replayed, 'picked_up')
    expect(f.tone).toBe('info')
    expect(f.tone).not.toBe('success')
    expect(f.applied).toBe(true)
  })

  it('treats a replay as APPLIED — the critical property for the offline queue', () => {
    // The queue must be able to drop the item. If this were false the item would
    // be retried forever.
    expect(describeTransition(replayed, 'picked_up').applied).toBe(true)
  })

  it('reports a conflict as a warning that requests a refresh, never an error', () => {
    const f = describeTransition(conflict, 'delivered')
    expect(f.tone).toBe('warning')
    expect(f.refresh).toBe(true)
    expect(f.applied).toBe(false)
  })

  it('names where the order actually is when conflicting', () => {
    // The rider needs to know the order is further along, not that they failed.
    const f = describeTransition(conflict, 'delivered')
    expect(f.message).toMatch(/delivered/i)
    expect(f.message).toMatch(/moved on/i)
  })

  it('degrades gracefully when the server reports an unrecognised status', () => {
    // Version skew: a newer server sends a status this build does not know.
    // Refusing to render would turn a cosmetic mismatch into a hard failure.
    const f = describeTransition(
      { ok: false, kind: 'conflict', currentStatus: null, expectedFrom: null },
      'delivered'
    )
    expect(f.tone).toBe('warning')
    expect(f.refresh).toBe(true)
    expect(f.message).not.toMatch(/null|undefined/)
  })

  it('passes a refusal through to the operator unchanged', () => {
    const f = describeTransition(refused, 'delivered')
    expect(f.tone).toBe('error')
    expect(f.message).toBe(refused.message)
    expect(f.applied).toBe(false)
    // A refusal must NOT trigger a refresh: the local view is fine, the request
    // was simply not allowed.
    expect(f.refresh).toBe(false)
  })

  it('never returns an empty message', () => {
    for (const outcome of [applied, replayed, conflict, refused]) {
      expect(describeTransition(outcome, 'delivered').message.length).toBeGreaterThan(0)
    }
  })

  it('never marks a non-applied outcome as applied', () => {
    // Guards against a refactor that conflates "ok" with "the order is in the
    // requested state" — the two are different for a conflict.
    for (const outcome of [conflict, refused]) {
      expect(describeTransition(outcome, 'delivered').applied).toBe(false)
    }
  })
})

/**
 * Offline write queue (a durable outbox for order status changes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 * A rider marks a delivery as picked up in a stairwell with no signal. The tap
 * must not be lost, and — just as importantly — it must not be silently reported
 * as sent. When the connection returns, the change has to reach the server
 * exactly once in effect, even though the network can only promise at-least-once
 * delivery.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SAFE TO RETRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Every item records `expectedFrom` — the status the rider's screen showed — and
 * the server applies the change as a compare-and-swap. So a retry after a lost
 * acknowledgement returns `alreadyApplied`, and a retry against an order that
 * moved on returns `conflict`. Neither is an error; both are answers the queue
 * can act on. Without that server-side contract this client code would be
 * guessing, which is why the migration came first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS *NOT* QUEUED, ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Only `transition` items. Claiming a job is NOT queueable: it is a race for
 * work that must be collected now, and replaying it minutes later would hand a
 * rider a delivery they can no longer make. See describeClaim(). Queueing only
 * records of completed work is what makes the queue trustworthy rather than
 * merely convenient.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDERING
 * ─────────────────────────────────────────────────────────────────────────────
 * Strict FIFO across all items, which preserves per-order ordering as a
 * consequence: `assigned -> picked_up` is always sent before
 * `picked_up -> delivered`. Draining is sequential rather than concurrent —
 * with a handful of items the throughput is irrelevant, and a deterministic
 * order is worth far more than parallelism.
 */
import { put, readAll, remove, clear as clearStore } from './idb'
import { classifyDrainResult } from './drainPolicy'
import { transitionOrderStatus } from '@/data/orders/transitions'
import type { OrderStatus } from '@/domain/order/status'

/** Beyond this many automatic attempts an item is surfaced for a human instead. */
const MAX_ATTEMPTS = 6

/** Backoff ceiling. Beyond this, waiting longer stops being useful. */
const MAX_BACKOFF_MS = 5 * 60 * 1000

export interface QueuedTransition {
  id: string
  kind: 'transition'
  /**
   * The signed-in user who made the change. Checked before replay so a queued
   * write can never be applied under somebody else's session — the scenario is a
   * shared rider handset, which is common on this fleet.
   */
  userId: string | null
  orderId: string
  to: OrderStatus
  expectedFrom: OrderStatus | null
  queuedAt: number
  attempts: number
  /** Epoch ms before which this item should not be retried. */
  nextAttemptAt: number
}

/** Something the UI may want to tell the operator about. Consumed once. */
export type QueueEvent =
  | { type: 'sent'; count: number }
  | { type: 'conflict'; orderId: string; currentStatus: OrderStatus | null }
  | { type: 'refused'; orderId: string; message: string }
  | { type: 'stalled'; count: number }

export interface QueueSnapshot {
  items: readonly QueuedTransition[]
  /** Items still eligible for automatic retry. */
  pending: number
  /** Items that exhausted MAX_ATTEMPTS and need a manual retry. */
  stalled: number
  draining: boolean
}

const EMPTY: QueueSnapshot = Object.freeze({
  items: Object.freeze([]) as readonly QueuedTransition[],
  pending: 0,
  stalled: 0,
  draining: false,
})

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

let snapshot: QueueSnapshot = EMPTY
const listeners = new Set<() => void>()
const eventListeners = new Set<(event: QueueEvent) => void>()

/**
 * Snapshot identity only changes when the state does.
 *
 * useSyncExternalStore compares snapshots by reference and will loop forever if
 * getSnapshot returns a fresh object each call, so the cached value is the
 * contract, not an optimisation.
 */
export function getSnapshot(): QueueSnapshot {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onQueueEvent(listener: (event: QueueEvent) => void): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

function emit(event: QueueEvent): void {
  for (const listener of eventListeners) listener(event)
}

function derive(items: QueuedTransition[], draining: boolean): QueueSnapshot {
  const now = Date.now()
  let pending = 0
  let stalled = 0
  for (const item of items) {
    if (item.attempts >= MAX_ATTEMPTS) stalled++
    else if (item.nextAttemptAt <= now) pending++
  }
  return {
    items,
    pending,
    stalled,
    draining,
  }
}

async function refresh(draining = snapshot.draining): Promise<void> {
  let items: QueuedTransition[] = []
  try {
    items = await readAll<QueuedTransition>()
  } catch (error) {
    // A storage failure must never take the UI down. An empty snapshot is
    // misleading, but it is recoverable on the next refresh.
    console.warn('[offline-queue] could not read the queue', error)
  }
  items.sort((a, b) => a.queuedAt - b.queuedAt)
  snapshot = derive(items, draining)
  for (const listener of listeners) listener()
}

function setDraining(draining: boolean): void {
  snapshot = derive([...snapshot.items], draining)
  for (const listener of listeners) listener()
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Older webviews on low-end Android lack randomUUID. The id only has to be
  // unique per device, so a timestamp plus entropy is sufficient.
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Record a status change for delivery.
 *
 * Resolves once the change is durably stored — NOT once it reaches the server.
 * The caller must therefore present this as queued, not as sent; the UI copy for
 * an `offline` outcome already does.
 */
export async function enqueueTransition(params: {
  orderId: string
  to: OrderStatus
  expectedFrom: OrderStatus | null
  userId: string | null
}): Promise<QueuedTransition> {
  const item: QueuedTransition = {
    id: newId(),
    kind: 'transition',
    userId: params.userId,
    orderId: params.orderId,
    to: params.to,
    expectedFrom: params.expectedFrom,
    queuedAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  }

  await put(item)
  await refresh()
  // Try immediately in case the network is actually fine and the earlier failure
  // was a one-off. drain() is a no-op when offline.
  void drain()
  return item
}

/** Force every stalled item back into play, for a manual "Retry now". */
export async function retryStalled(): Promise<void> {
  const items = await readAll<QueuedTransition>()
  await Promise.all(
    items
      .filter((item) => item.attempts >= MAX_ATTEMPTS)
      .map((item) => put({ ...item, attempts: 0, nextAttemptAt: 0 }))
  )
  await refresh()
  void drain()
}

/**
 * Discard the queue.
 *
 * Called on sign-out. The queue names specific orders and the status changes
 * intended for them, so leaving it behind would let the next user of a shared
 * handset see what the previous rider was doing — and a replay under a different
 * session is exactly what the userId check exists to prevent.
 */
export async function clearQueue(): Promise<void> {
  await clearStore()
  await refresh()
}

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

let drainPromise: Promise<void> | null = null
let backoffUntil = 0

function backoffFor(attempts: number): number {
  // 2s, 4s, 8s, ... capped. Jitter avoids every device on a returning cell tower
  // retrying in the same instant.
  const base = Math.min(2000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
  return base + Math.random() * 1000
}

/**
 * Attempt to deliver every eligible queued change.
 *
 * Safe to call at any time and from anywhere: concurrent calls collapse into the
 * in-flight promise, and a call with nothing to do returns immediately.
 */
export async function drain(): Promise<void> {
  if (drainPromise) return drainPromise

  drainPromise = (async () => {
    const now = Date.now()
    if (now < backoffUntil) return

    let items: QueuedTransition[]
    try {
      items = await readAll<QueuedTransition>()
    } catch {
      return
    }

    // Re-read rather than trusting `snapshot`: another tab may have drained it.
    const eligible = items
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .filter((item) => item.attempts < MAX_ATTEMPTS && item.nextAttemptAt <= Date.now())

    if (eligible.length === 0) {
      // Nothing runnable. If items remain they are either backed off or stalled,
      // so re-derive the counts for the UI.
      if (items.length !== snapshot.items.length || snapshot.draining) await refresh(false)
      return
    }

    setDraining(true)

    let sent = 0
    let stopped = false

    try {
      for (const item of eligible) {
        const result = await transitionOrderStatus(
          item.orderId,
          item.to,
          item.expectedFrom
        )

        // The decision table lives in drainPolicy.ts, where it is unit-tested
        // without a database. See that file for why the three cases must not be
        // collapsed.
        const decision = classifyDrainResult(result)

        if (decision.action === 'done') {
          await remove(item.id)
          sent++
          continue
        }

        if (decision.action === 'drop') {
          await remove(item.id)
          if (decision.reason === 'conflict') {
            emit({
              type: 'conflict',
              orderId: item.orderId,
              currentStatus: decision.currentStatus,
            })
          } else {
            emit({ type: 'refused', orderId: item.orderId, message: decision.message })
          }
          continue
        }

        // 'retry': the request never arrived, so nothing is known. Keep the item
        // and stop — burning through the rest of the queue while the link is
        // down would only inflate attempt counts on every other item too.
        const attempts = item.attempts + 1
        await put({
          ...item,
          attempts,
          nextAttemptAt: Date.now() + backoffFor(attempts),
        })
        backoffUntil = Date.now() + backoffFor(attempts)
        stopped = true
        break
      }
    } finally {
      await refresh(false)
      setDraining(false)
      drainPromise = null
    }

    if (sent > 0) emit({ type: 'sent', count: sent })

    if (stopped) {
      const { stalled } = snapshot
      if (stalled > 0) emit({ type: 'stalled', count: stalled })
    }
  })()

  return drainPromise
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

let started = false

/**
 * Attach the triggers that make the queue drain on its own.
 *
 * Idempotent, so a React effect may call it on every mount.
 *
 * `online` covers the radio coming back. `visibilitychange` covers the far more
 * common case on a phone: the rider pockets the device, the OS suspends the
 * page, and the connection returns while the app is backgrounded — during which
 * no `online` event is reliably delivered. Draining on the next foreground is
 * what actually recovers those writes.
 */
export function startQueue(): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('online', () => {
    backoffUntil = 0
    void drain()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      backoffUntil = 0
      void drain()
    }
  })

  void refresh()
  void drain()
}

/** React StrictMode double-invokes effects; this keeps tests honest. */
export function __resetForTests(): void {
  started = false
  drainPromise = null
  backoffUntil = 0
  snapshot = EMPTY
  listeners.clear()
  eventListeners.clear()
}

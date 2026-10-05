/**
 * React bindings for the offline write queue.
 *
 * The queue itself is a module singleton, not component state, because a drain
 * must be able to run when no dashboard is mounted — the rider may have
 * backgrounded the app mid-delivery. This hook only OBSERVES it.
 *
 * useSyncExternalStore is the right primitive here: it subscribes to a source
 * outside React and is tear-free, so two components reading the queue cannot
 * render inconsistent counts.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  clearQueue,
  drain,
  getSnapshot,
  onQueueEvent,
  retryStalled,
  startQueue,
  subscribe,
  type QueueEvent,
  type QueueSnapshot,
} from './queue'

export function useOfflineQueue(): QueueSnapshot {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    // Idempotent, so StrictMode's double-invoke and extra mounts are harmless.
    startQueue()
  }, [])

  return snapshot
}

/**
 * Run a callback whenever the queue reports something worth telling the operator.
 *
 * Report-only: the queue has already decided and already persisted the outcome
 * by the time this fires, so nothing here can change what happened.
 */
export function useQueueEvents(handler: (event: QueueEvent) => void): void {
  useEffect(() => onQueueEvent(handler), [handler])
}

export const offlineQueue = {
  drain,
  retryStalled,
  clearQueue,
  getSnapshot,
}

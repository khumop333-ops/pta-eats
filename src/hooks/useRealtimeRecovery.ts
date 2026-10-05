/**
 * Recovery of realtime events missed while the connection was down.
 *
 * Realtime delivery is best-effort: a Supabase channel drops silently when the
 * radio dies and reconnects when it returns, and anything published in between
 * is simply gone. Nothing replays it. Every dashboard in this app therefore had
 * a stale list after any dropout — a rider would finish a delivery and the
 * dispatcher's screen would still show it as out for delivery, indefinitely.
 *
 * There is no way to ask a realtime channel for "what did I miss". The only
 * correct answer is to re-read the authoritative rows. These hooks decide WHEN,
 * because doing it too eagerly is its own bug: a refetch per event, or one per
 * App State transition, would hammer a 3G connection.
 *
 * Two separate triggers, because they catch different failures:
 *
 *   online / foreground  - the radio came back, or the app was resumed. Catches
 *                          drops that happened while the page was suspended,
 *                          which on a phone is the common case: a rider pockets
 *                          the device in a stairwell with no signal.
 *   channel resubscribe  - the websocket itself dropped and came back, even
 *                          though the device never lost its network. Catches
 *                          short blips that raise no browser event at all.
 */
import { useCallback, useEffect, useRef } from 'react'

/** Keeps a stable identity for a callback that is redefined on every render. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/**
 * Refetch when the browser regains connectivity or the app returns to the
 * foreground.
 *
 * Throttled: `online` and `visibilitychange` frequently fire within milliseconds
 * of each other on resume, and a doubled query is a real cost on a metered
 * mobile connection.
 */
export function useRefetchOnReconnect(refetch: () => void | Promise<void>): void {
  const latest = useLatest(refetch)

  useEffect(() => {
    const MIN_INTERVAL_MS = 1000
    let lastRun = 0

    const run = () => {
      const now = Date.now()
      if (now - lastRun < MIN_INTERVAL_MS) return
      lastRun = now
      void latest.current()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') run()
    }

    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [latest])
}

/**
 * Pass the returned function to `channel.subscribe()`.
 *
 * The first SUBSCRIBED status is ignored on purpose: it is the initial
 * connection, and the caller has just fetched. Only a RE-subscription means a
 * gap existed that events could have been lost in.
 */
export function useRealtimeResubscribe(
  refetch: () => void | Promise<void>
): (channelStatus: string) => void {
  const latest = useLatest(refetch)
  const seenFirstSubscribe = useRef(false)

  return useCallback(
    (channelStatus: string) => {
      if (channelStatus !== 'SUBSCRIBED') return
      if (!seenFirstSubscribe.current) {
        seenFirstSubscribe.current = true
        return
      }
      void latest.current()
    },
    [latest]
  )
}

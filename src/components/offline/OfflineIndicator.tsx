/**
 * Connection + outbox status.
 *
 * Mounted once at the app root so it is visible on every screen — a rider who
 * taps "mark delivered" and sees nothing happen needs to know immediately that
 * the tap was kept, not lost. Silence is the failure mode this exists to prevent.
 *
 * It reports three different things, and they are genuinely different:
 *   offline            - nothing can be sent right now
 *   pending > 0        - changes are held and will send on their own
 *   stalled > 0        - automatic retries gave up; a human must act
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CloudOff, RefreshCw, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { useOfflineQueue, useQueueEvents } from '@/lib/offline/useOfflineQueue'
import { offlineQueue } from '@/lib/offline/useOfflineQueue'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** navigator.onLine is a hint, not the truth, but it is the only synchronous one. */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}

export function OfflineIndicator() {
  const online = useOnlineStatus()
  const { pending, stalled, draining } = useOfflineQueue()
  const [retrying, setRetrying] = useState(false)

  // Report drains once, when they happen — not on every render.
  useQueueEvents((event) => {
    switch (event.type) {
      case 'sent':
        toast.success(
          event.count === 1
            ? 'Saved change sent.'
            : `${event.count} saved changes sent.`
        )
        break
      case 'conflict':
        toast.warning('An order moved on while you were offline — your change was not needed.')
        break
      case 'refused':
        toast.error(event.message)
        break
      case 'stalled':
        toast.warning(
          `${event.count} change${event.count === 1 ? '' : 's'} could not be sent. Tap to retry.`
        )
        break
    }
  })

  const held = pending + stalled
  if (online && held === 0) return null

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await offlineQueue.retryStalled()
      await offlineQueue.drain()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      // `status` + polite: a screen reader should hear this after the current
      // announcement, not have it interrupt mid-sentence.
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t px-3 py-2',
        'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        'flex items-center gap-3 text-sm',
        stalled > 0
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-secondary text-secondary-foreground'
      )}
    >
      {stalled > 0 ? (
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : online ? (
        <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}

      <p className="min-w-0 flex-1">
        {stalled > 0 ? (
          <>
            <span className="font-medium">
              {stalled} change{stalled === 1 ? '' : 's'} couldn&rsquo;t be sent.
            </span>{' '}
            Nothing has been lost.
          </>
        ) : !online ? (
          <>
            <span className="font-medium">No connection.</span>{' '}
            {held > 0
              ? `${held} change${held === 1 ? '' : 's'} saved — sending automatically.`
              : 'Changes you make are saved and sent automatically.'}
          </>
        ) : (
          <>
            <span className="font-medium">
              {held} saved change{held === 1 ? '' : 's'} waiting to send
            </span>
            {draining ? ' — sending…' : '.'}
          </>
        )}
      </p>

      {stalled > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleRetry}
          disabled={retrying || draining}
          className="shrink-0"
        >
          <RefreshCw
            className={cn('mr-1 h-3.5 w-3.5', (retrying || draining) && 'animate-spin')}
            aria-hidden="true"
          />
          Retry now
        </Button>
      )}
    </div>
  )
}

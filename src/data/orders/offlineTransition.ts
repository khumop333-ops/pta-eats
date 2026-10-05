/**
 * Attempt a status change, queueing it if the network is unreachable.
 *
 * This is the entry point the dashboards use. It composes two things that must
 * agree — the RPC wrapper and the offline outbox — and deliberately lives in its
 * own module rather than inside either of them: `queue.ts` imports the RPC
 * wrapper, so putting this composition in the wrapper would create a cycle.
 *
 * The rule is small and worth stating: an attempt that never reached the server
 * is durably recorded before the caller is told anything. A `refused` result is
 * NOT queued, because the server answered and retrying the same payload would
 * produce the same answer.
 */
import { supabase } from '@/integrations/supabase/client'
import { transitionOrderStatus } from './transitions'
import { enqueueTransition } from '@/lib/offline/queue'
import type { OrderStatus } from '@/domain/order/status'
import type { TransitionOutcome } from '@/domain/order/transition'

/**
 * Who is making this change.
 *
 * Resolved here rather than passed in by each caller: the three dashboards get
 * their identity from three different contexts (AuthContext, AdminAuthContext,
 * and a direct session read in the owner screen), so threading a userId through
 * all of them would mean three chances to pass the wrong one. A queued write
 * recorded against the wrong user is exactly the bug the field exists to catch.
 */
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

export async function transitionOrQueue(params: {
  orderId: string
  to: OrderStatus
  /** The status the operator's screen showed — the compare-and-swap expectation. */
  expectedFrom: OrderStatus | null
}): Promise<TransitionOutcome> {
  const outcome = await transitionOrderStatus(
    params.orderId,
    params.to,
    params.expectedFrom
  )

  if (outcome.ok || outcome.kind !== 'offline') return outcome

  try {
    await enqueueTransition({
      orderId: params.orderId,
      to: params.to,
      expectedFrom: params.expectedFrom,
      userId: await currentUserId(),
    })
  } catch (error) {
    // Storage refused (quota exhausted, or IndexedDB unavailable in this
    // context). Report the change as not saved rather than claiming it is
    // queued — a promise the app cannot keep is worse than an honest failure.
    console.error('[offline-queue] could not persist the change', error)
    return {
      ok: false,
      kind: 'refused',
      message: "Couldn't save that change offline. Keep the app open and try again.",
    }
  }

  return outcome
}

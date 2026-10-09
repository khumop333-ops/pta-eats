-- ============================================================================
-- ROMA — Replay-safe transitions (G3 prerequisite)
-- 2026-10-05
--
-- WHY THIS EXISTS
-- ---------------
-- An offline write queue must be able to RE-SEND a mutation whose response was
-- lost to a dropped connection. The dangerous case is not failure — it is SUCCESS
-- THAT WE DID NOT HEAR ABOUT. The server applied the change; the network died
-- before the ack; the client only knows it must retry.
--
-- Measured behaviour before this migration (probe in the commit message):
--     assigned -> picked_up (first call)   : SUCCESS, status=picked_up
--     assigned -> picked_up (replayed)     : REJECTED  illegal_transition
--
-- So a rider who marked a parcel picked up on a dead link would retry, be told
-- the change was ILLEGAL, and correctly conclude the app is lying to them. The
-- client cannot distinguish "already applied, you're fine" from "this genuinely
-- cannot happen", because both surface as the same sqlstate.
--
-- THE FIX: COMPARE-AND-SWAP
-- -------------------------
-- The caller declares what it believed the state was (`p_expected_from`), and
-- gets back one of three honest answers:
--
--     ok: true,  alreadyApplied: true   — a previous attempt landed. Nothing to do.
--     ok: true,  alreadyApplied: false  — applied now.
--     ok: false, error: 'conflict'       — the world moved; here is where it is.
--
-- The conflict case is returned as DATA, not as an exception, because a conflict
-- is not a violation — it is a normal fact of concurrent editing that the queue
-- must reconcile. Exceptions remain for genuine violations (not your order, not
-- permitted, no such transition).
--
-- ORDERING NOTE: legality of the INTENT is checked BEFORE looking at the current
-- position. Otherwise a request could be blessed merely because the row happened
-- to already be in the target state — turning this from an idempotency guard into
-- an authorisation bypass.
--
-- ALSO FIXED HERE: the storage-layer trigger permits a no-op status write
-- (it early-returns on `IS NOT DISTINCT FROM OLD`), while the RPC rejected one.
-- Two enforcement paths, disagreeing. Both now accept a no-op as a no-op.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — REPLAY-SAFE STATUS TRANSITION
-- ============================================================================

-- THIS DROP IS LOAD-BEARING, NOT TIDYING.
--
-- CREATE OR REPLACE with an added parameter creates an OVERLOAD, not a
-- replacement. And because the new third parameter has a DEFAULT, it is callable
-- with TWO arguments — so `transition_order_status(id, status)` matches BOTH
-- functions and Postgres cannot choose. Verified in isolation:
--
--     two-arg call: AMBIGUOUS -> function t(unknown, unknown) is not unique
--     (after dropping the two-arg overload: resolves to the three-arg function)
--
-- Omitting this DROP would break EVERY transition call in the application with
-- "is not unique" — a total outage of the dispatch flow, not a subtle bug.
DROP FUNCTION IF EXISTS public.transition_order_status(uuid, text);

CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id      uuid,
  p_to            text,
  p_expected_from text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor   text;
  v_order   public.orders;
  v_allowed boolean;
  v_pair_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_actor := public.current_actor();

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorisation: a deliverer may only act on the order assigned to them.
  IF v_actor = 'deliverer' AND v_order.deliverer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_order' USING ERRCODE = '42501';
  END IF;

  IF p_expected_from IS NOT NULL THEN
    -- ------------------------------------------------------------------
    -- Compare-and-swap path (used by the offline queue)
    -- ------------------------------------------------------------------

    -- NO-OP ASSERTION: "ensure this order is in state X".
    --
    -- Some queues store only the target state, so a retry can arrive as
    -- (expected_from = X, to = X). That is not a transition, and `X -> X` is
    -- deliberately absent from order_status_transitions — so consulting the pair
    -- table would misreport a no-op as an illegal transition.
    --
    -- Handled before the pair lookup, and it CANNOT become an authorisation
    -- bypass: this branch never changes a row. Ownership was already enforced
    -- above, and the caller only learns a state they can already read.
    IF p_expected_from = p_to THEN
      IF v_order.status = p_to THEN
        RETURN jsonb_build_object(
          'ok', true, 'alreadyApplied', true, 'order', to_jsonb(v_order)
        );
      END IF;
      RETURN jsonb_build_object(
        'ok',            false,
        'error',         'conflict',
        'currentStatus', v_order.status,
        'expectedFrom',  p_expected_from
      );
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.order_status_transitions
       WHERE from_status = p_expected_from AND to_status = p_to AND actor = v_actor
    ) INTO v_allowed;

    IF NOT v_allowed THEN
      -- Distinguish "nobody may do this" from "you personally may not".
      SELECT EXISTS (
        SELECT 1 FROM public.order_status_transitions
         WHERE from_status = p_expected_from AND to_status = p_to
      ) INTO v_pair_ok;

      IF v_pair_ok THEN
        RAISE EXCEPTION 'actor_not_permitted' USING ERRCODE = '42501';
      ELSE
        RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Idempotent success: a previous attempt already landed, and we know the
    -- intent was legal because we checked that above.
    IF v_order.status = p_to THEN
      RETURN jsonb_build_object(
        'ok', true, 'alreadyApplied', true, 'order', to_jsonb(v_order)
      );
    END IF;

    -- The world moved somewhere we did not predict. Report it rather than throw:
    -- the queue needs to reconcile, not crash.
    IF v_order.status IS DISTINCT FROM p_expected_from THEN
      RETURN jsonb_build_object(
        'ok',             false,
        'error',          'conflict',
        'currentStatus',  v_order.status,
        'expectedFrom',   p_expected_from
      );
    END IF;

  ELSE
    -- ------------------------------------------------------------------
    -- Strict path (no expectation declared): validate against current state.
    -- Retained for dashboards that have freshly read the row.
    -- ------------------------------------------------------------------
    SELECT EXISTS (
      SELECT 1 FROM public.order_status_transitions
       WHERE from_status = v_order.status AND to_status = p_to AND actor = v_actor
    ) INTO v_allowed;

    IF NOT v_allowed THEN
      -- A no-op is accepted here, matching the trigger's behaviour, so that the
      -- two enforcement paths cannot disagree. A no-op is never a bypass.
      IF v_order.status IS NOT DISTINCT FROM p_to THEN
        RETURN jsonb_build_object(
          'ok', true, 'alreadyApplied', true, 'order', to_jsonb(v_order)
        );
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.order_status_transitions
         WHERE from_status = v_order.status AND to_status = p_to
      ) INTO v_pair_ok;

      IF v_pair_ok THEN
        RAISE EXCEPTION 'actor_not_permitted' USING ERRCODE = '42501';
      ELSE
        RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  UPDATE public.orders
     SET status       = p_to,
         assigned_at  = CASE WHEN p_to = 'assigned'  THEN now() ELSE assigned_at  END,
         picked_up_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE picked_up_at END,
         delivered_at = CASE WHEN p_to = 'delivered' THEN now() ELSE delivered_at END
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('ok', true, 'alreadyApplied', false, 'order', to_jsonb(v_order));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text) TO authenticated, service_role;


-- ============================================================================
-- SECTION 2 — REPLAY-SAFE CLAIM
-- ============================================================================
-- claim_order() had the identical problem. Its guard is
-- `deliverer_id IS NULL`, so a rider who successfully claimed a job and lost the
-- response would retry, find the row no longer unassigned, and be told
-- `order_unavailable` — i.e. "another rider just took this job". They would give
-- up on a delivery that is actually theirs, which is worse than the transition
-- case: the customer waits, and the job sits uncollected.
--
-- The SKIP LOCKED race protection is preserved exactly. Only the "is it already
-- mine?" case is added, ahead of it.
CREATE OR REPLACE FUNCTION public.claim_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_role(auth.uid(), 'deliverer') THEN
    RAISE EXCEPTION 'not_a_deliverer' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_within_service_window() THEN
    RAISE EXCEPTION 'outside_service_window' USING ERRCODE = 'P0001';
  END IF;

  -- REPLAY CHECK: is this already mine? A previous claim that we never heard
  -- back from. Deliberately does NOT require status = 'assigned': if the rider
  -- claimed and then advanced the order before the ack was lost, the claim still
  -- succeeded and must still report success.
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     AND deliverer_id = auth.uid();

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'alreadyClaimed', true, 'order', to_jsonb(v_order)
    );
  END IF;

  -- Unchanged: atomic single-winner claim. SKIP LOCKED is the whole point —
  -- two riders tapping simultaneously means one wins, the other gets
  -- order_unavailable, never a shared delivery.
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     AND status = 'ready'
     AND deliverer_id IS NULL
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_unavailable' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.orders
     SET deliverer_id = auth.uid(),
         status       = 'assigned',
         assigned_at  = now()
   WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('ok', true, 'alreadyClaimed', false, 'order', to_jsonb(v_order));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_order(uuid) TO authenticated, service_role;

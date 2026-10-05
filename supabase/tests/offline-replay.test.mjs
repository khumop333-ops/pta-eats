/**
 * OFFLINE REPLAY SUITE — is it safe to re-send a mutation we never got an ack for?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS PINS DOWN
 * ─────────────────────────────────────────────────────────────────────────────
 * An offline write queue must be able to retry a mutation whose RESPONSE was lost.
 * The dangerous case is not failure — it is success we did not hear about. The
 * server applied the change; the network died before the ack.
 *
 * Measured before 20261005160000_offline_safe_transitions.sql:
 *
 *     assigned -> picked_up (first call) : SUCCESS, status = picked_up
 *     assigned -> picked_up (replayed)   : REJECTED  illegal_transition
 *
 * A rider on a dead link would retry, be told the change was ILLEGAL, and
 * reasonably conclude the app is lying. They would either re-attempt work already
 * done or give up on work that had actually landed.
 *
 * This suite asserts the replaced behaviour — idempotent success, reported
 * conflicts — and, critically, that idempotency did NOT become an authorisation
 * bypass.
 *
 * Coverage caveats live in _harness.mjs. Notably: no true concurrency is
 * simulated, so the two-session race for SKIP LOCKED still needs a real Supabase
 * test before go-live.
 */
import {
  ALL_UNDER_TEST,
  applyFiles,
  assertAuthShimWorks,
  asUser,
  baselineFiles,
  createShimmedDb,
  grantClientPrivileges,
  installCrashHandler,
  makeReporter,
} from './_harness.mjs'

installCrashHandler()

const db = await createShimmedDb()
const { ok, rejects, summary } = makeReporter(db)

const CUST = '11111111-1111-1111-1111-111111111111'
const DRIVER_A = '22222222-2222-2222-2222-222222222222'
const DRIVER_B = '33333333-3333-3333-3333-333333333333'

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m1. Shim + full schema\x1b[0m')
await assertAuthShimWorks(db, DRIVER_A)
console.log('  auth.uid() resolves from the session GUC')

await applyFiles(db, baselineFiles(ALL_UNDER_TEST), { label: 'baseline' })
await applyFiles(db, ALL_UNDER_TEST, { label: 'under test' })
await grantClientPrivileges(db)

await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${CUST}','c@t.test'), ('${DRIVER_A}','a@t.test'), ('${DRIVER_B}','b@t.test');
  INSERT INTO public.user_roles (user_id, role) VALUES
    ('${DRIVER_A}','deliverer'), ('${DRIVER_B}','deliverer');
  INSERT INTO public.restaurants (id,name,cuisine) VALUES (1,'R','T');
`)

// Force the window open: this suite is about replay semantics, not scheduling.
// The window itself is covered in dispatch.test.mjs.
await db.exec(`CREATE OR REPLACE FUNCTION public.is_within_service_window()
  RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;`)

/** Seed an order directly, in a given state, assigned to a given rider. */
let seq = 0
async function seed(status, delivererId = DRIVER_A) {
  const id = `ffffffff-0000-0000-0000-${String(++seq).padStart(12, '0')}`
  await db.exec(`
    INSERT INTO public.orders (id, customer_name, phone_number, delivery_address,
      restaurant_id, restaurant_name, subtotal, delivery_fee_cents, total, status,
      user_id, deliverer_id, assigned_at)
    VALUES ('${id}','Replay','+27','1 St',1,'R',100,1500,115,'${status}','${CUST}',
      ${delivererId ? `'${delivererId}'` : 'NULL'},
      ${delivererId ? 'now()' : 'NULL'});
  `)
  return id
}

async function as(uid, fn) {
  await db.exec(asUser(uid))
  return fn()
}

/** Call the CAS RPC and return the parsed envelope (or the raised error). */
async function transition(id, to, expectedFrom) {
  try {
    const r = await db.query(
      expectedFrom === undefined
        ? `SELECT public.transition_order_status($1::uuid, $2) AS r`
        : `SELECT public.transition_order_status($1::uuid, $2, $3) AS r`,
      expectedFrom === undefined ? [id, to] : [id, to, expectedFrom]
    )
    return { raised: false, result: r.rows[0].r }
  } catch (e) {
    return { raised: true, message: String(e.message).split('\n')[0] }
  }
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m2. THE HEADLINE FIX — replay of an applied transition\x1b[0m')
{
  const order = await seed('assigned')
  await db.exec(asUser(DRIVER_A))

  const first = await transition(order, 'picked_up', 'assigned')
  ok('first call applies and reports alreadyApplied=false',
    !first.raised && first.result.ok === true && first.result.alreadyApplied === false,
    JSON.stringify(first))
  ok('the order is now picked_up', first.result.order.status === 'picked_up')

  // The retry that used to be rejected as illegal_transition.
  const replay = await transition(order, 'picked_up', 'assigned')
  ok('REPLAY returns success instead of illegal_transition',
    !replay.raised && replay.result.ok === true,
    replay.raised ? replay.message : JSON.stringify(replay.result))
  ok('REPLAY is flagged alreadyApplied=true',
    replay.result.alreadyApplied === true, JSON.stringify(replay.result))
  ok('replay does not move the order again', replay.result.order.status === 'picked_up')
  ok('replay does not restamp picked_up_at',
    replay.result.order.picked_up_at === first.result.order.picked_up_at)
}

console.log('\n\x1b[1m3. Three distinct answers: applied, already-applied, conflict\x1b[0m')
{
  const order = await seed('assigned')
  await db.exec(asUser(DRIVER_A))

  const applied = await transition(order, 'picked_up', 'assigned')
  const again = await transition(order, 'picked_up', 'assigned')
  ok('applied      -> ok:true,  alreadyApplied:false',
    applied.result.ok === true && applied.result.alreadyApplied === false)
  ok('already-applied -> ok:true, alreadyApplied:true',
    again.result.ok === true && again.result.alreadyApplied === true)
}
{
  // A conflict requires a LEGAL intent whose world has moved on. `ready -> picked_up`
  // would NOT be a conflict — it is an illegal pair (a rider must pass through
  // `assigned`), so raising is correct there. Verify that distinction separately.
  const order = await seed('assigned')
  await db.exec(asUser(DRIVER_A))

  // Legal pair (picked_up -> delivered) but the order is still `assigned`:
  // this rider's queue believes they already collected it. Classic stale writer.
  const conflict = await transition(order, 'delivered', 'picked_up')
  ok('a legal intent against a moved-on row returns ok:false, NOT an exception',
    !conflict.raised && conflict.result.ok === false && conflict.result.error === 'conflict',
    conflict.raised ? `RAISED: ${conflict.message}` : JSON.stringify(conflict.result))
  ok('conflict reports where the order actually is (currentStatus)',
    conflict.raised ? false : conflict.result.currentStatus === 'assigned',
    conflict.raised ? conflict.message : JSON.stringify(conflict.result))
  ok('conflict echoes what the caller expected (expectedFrom)',
    conflict.raised ? false : conflict.result.expectedFrom === 'picked_up')
  ok('a conflicting call changes nothing',
    (await db.query(`SELECT status FROM public.orders WHERE id='${order}'`)).rows[0].status === 'assigned')

  // An illegal PAIR must still raise, even though it also "does not match".
  const illegal = await transition(order, 'picked_up', 'ready')
  ok('an illegal pair raises illegal_transition (not a silent conflict)',
    illegal.raised && illegal.message.includes('illegal_transition'),
    illegal.raised ? illegal.message : JSON.stringify(illegal.result))
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m4. IDEMPOTENCY MUST NOT BECOME AN AUTHORISATION BYPASS\x1b[0m')
// This is the subtle one. Legality is checked BEFORE the current position, so a
// request cannot be blessed merely because the row already happens to be in the
// target state. Without that ordering, the idempotency shortcut would let any
// actor claim success for an action they were never permitted to take.
{
  // An order already sitting at 'cancelled', assigned to driver A.
  const order = await seed('cancelled')
  await db.exec(asUser(DRIVER_A))

  // Driver A asks to cancel it, claiming it was 'pending'. A deliverer may never
  // cancel — only customer or system. The order IS already at the target state,
  // so a naive idempotency check would answer "already applied, you're fine".
  const res = await transition(order, 'cancelled', 'pending')
  ok('an illegal intent is REJECTED even though the order is already in the target state',
    res.raised && res.message.includes('actor_not_permitted'),
    res.raised ? res.message : `WRONGLY ACCEPTED: ${JSON.stringify(res.result)}`)
}
{
  // And a transition nobody may make at all.
  const order = await seed('ready', DRIVER_A)
  await db.exec(asUser(DRIVER_A))
  const res = await transition(order, 'delivered', 'ready')
  ok('ready -> delivered is still illegal for a rider (must pass through assigned)',
    res.raised && res.message.includes('illegal_transition'),
    res.raised ? res.message : `WRONGLY ACCEPTED: ${JSON.stringify(res.result)}`)
}
{
  // Ownership still enforced on the CAS path.
  const order = await seed('assigned', DRIVER_A)
  await db.exec(asUser(DRIVER_B))
  const res = await transition(order, 'picked_up', 'assigned')
  ok("another rider cannot replay someone else's transition",
    res.raised && res.message.includes('not_your_order'),
    res.raised ? res.message : `WRONGLY ACCEPTED: ${JSON.stringify(res.result)}`)
}
{
  // A no-op ASSERTION ("ensure this order is at X") must never move the order.
  // The order is `assigned`; the caller asserts it is already `picked_up`.
  const order = await seed('assigned', DRIVER_A)
  await db.exec(asUser(DRIVER_A))
  const res = await transition(order, 'picked_up', 'picked_up')
  ok('a no-op assertion against a mismatched state returns conflict, not success',
    !res.raised && res.result.ok === false && res.result.error === 'conflict',
    res.raised ? res.message : JSON.stringify(res.result))
  ok('and the no-op assertion did NOT move the order',
    (await db.query(`SELECT status FROM public.orders WHERE id='${order}'`)).rows[0]
      .status === 'assigned',
    'a no-op assertion must never be able to perform the transition it claims is already done')
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m5. Claim is replay-safe too\x1b[0m')
// Same defect, worse consequence: a rider who claimed a job and lost the ack would
// be told "another rider just took this job" and abandon a delivery that is
// actually theirs. The customer waits and nobody collects.
{
  const order = await seed('ready', null)
  await db.exec(asUser(DRIVER_A))

  const first = await db.query(`SELECT public.claim_order($1::uuid) AS c`, [order])
  ok('first claim succeeds and reports alreadyClaimed=false',
    first.rows[0].c.ok === true && first.rows[0].c.alreadyClaimed === false)
  ok('the order is assigned to the claimant', first.rows[0].c.order.deliverer_id === DRIVER_A)

  const replay = await db.query(`SELECT public.claim_order($1::uuid) AS c`, [order])
  ok('REPLAY of a successful claim reports success, not order_unavailable',
    replay.rows[0].c.ok === true && replay.rows[0].c.alreadyClaimed === true,
    JSON.stringify(replay.rows[0].c))

  // And a genuinely lost race still fails correctly.
  await db.exec(asUser(DRIVER_B))
  const other = await transition(order, 'picked_up', 'assigned')
  ok('a different rider still cannot touch the claimed order',
    other.raised && other.message.includes('not_your_order'))
}
{
  // The rider claimed, then advanced the order, and only THEN lost the ack.
  // Replaying the claim must still report success — the claim did happen.
  const order = await seed('ready', null)
  await db.exec(asUser(DRIVER_A))
  await db.query(`SELECT public.claim_order($1::uuid)`, [order])
  await transition(order, 'picked_up', 'assigned')

  const lateReplay = await db.query(`SELECT public.claim_order($1::uuid) AS c`, [order])
  ok('replaying a claim AFTER the order advanced still reports success',
    lateReplay.rows[0].c.ok === true && lateReplay.rows[0].c.alreadyClaimed === true,
    JSON.stringify(lateReplay.rows[0].c))
  ok('the late replay does not reset the status back to assigned',
    lateReplay.rows[0].c.order.status === 'picked_up')
}
{
  const order = await seed('ready', null)
  await db.exec(asUser(DRIVER_A))
  await rejects('a non-deliverer still cannot claim',
    `${asUser(CUST)} SELECT public.claim_order('${order}');`, 'not_a_deliverer')
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m6. Simulated queue drain with a lost ack\x1b[0m')
// The end-to-end shape of a real dropout: the rider performs two actions, the
// network dies before either ack arrives, the queue replays BOTH in order.
{
  const order = await seed('assigned')
  const queue = [
    { to: 'picked_up', from: 'assigned' },
    { to: 'delivered', from: 'picked_up' },
  ]

  await db.exec(asUser(DRIVER_A))

  // --- First drain: both writes reach the server, both acks are lost.
  const serverState = []
  for (const item of queue) serverState.push(await transition(order, item.to, item.from))
  ok('both writes applied server-side on the first drain',
    serverState.every((r) => !r.raised && r.result.ok && r.result.alreadyApplied === false),
    JSON.stringify(serverState.map((r) => r.result?.alreadyApplied)))

  // --- Second drain: the queue retries both, exactly as it would after reconnect.
  const replayState = []
  for (const item of queue) replayState.push(await transition(order, item.to, item.from))

  // NOTHING RAISES. That is the whole guarantee: a replayed queue never produces a
  // spurious exception that the rider's device would surface as a failure.
  ok('replaying the whole queue raises nothing',
    replayState.every((r) => !r.raised),
    JSON.stringify(replayState.map((r) => (r.raised ? r.message : r.result.error ?? 'ok'))))

  // Item 1 targeted `picked_up`; the order is already `delivered`, i.e. BEYOND it.
  // Reporting that as a conflict — with currentStatus — is the correct answer: the
  // queue learns the order progressed past this item rather than being told a lie.
  ok('item 1 reports a conflict showing the order moved PAST it',
    replayState[0].result.ok === false &&
      replayState[0].result.error === 'conflict' &&
      replayState[0].result.currentStatus === 'delivered',
    JSON.stringify(replayState[0].result))

  // Item 2 targeted `delivered`; that is exactly where the order sits -> true replay.
  ok('item 2 is flagged alreadyApplied (it landed on the current state)',
    replayState[1].result.ok === true && replayState[1].result.alreadyApplied === true,
    JSON.stringify(replayState[1].result))
  ok('the order ends in delivered', replayState[1].result.order.status === 'delivered')

  // --- Out-of-order replay: the queue must never apply a later step first.
  const other = await seed('assigned')
  await db.exec(asUser(DRIVER_A))
  const outOfOrder = await transition(other, 'delivered', 'picked_up')
  const afterOutOfOrder = (await db.query(
    `SELECT status FROM public.orders WHERE id='${other}'`)).rows[0].status
  ok('a queued write replayed out of order does not corrupt state',
    afterOutOfOrder === 'assigned',
    `status became ${afterOutOfOrder}; out-of-order result ${JSON.stringify(outOfOrder)}`)
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m7. The 2-arg overload must be GONE\x1b[0m')
// transition_order_status(uuid, text, text DEFAULT NULL) is callable with two
// arguments, so leaving the old 2-arg function in place makes every 2-arg call
// ambiguous — "function ... is not unique" — a total outage of the dispatch flow.
{
  const fns = await db.query(`
    SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'transition_order_status'
     ORDER BY args`)
  const args = fns.rows.map((r) => r.args)
  ok('exactly one transition_order_status exists', args.length === 1, JSON.stringify(args))
  ok('and it is the 3-argument CAS form',
    args[0] === 'p_order_id uuid, p_to text, p_expected_from text', JSON.stringify(args))

  // Prove a 2-arg call still resolves (rather than erroring as ambiguous).
  const order = await seed('assigned')
  await db.exec(asUser(DRIVER_A))
  const strict = await transition(order, 'picked_up')
  ok('a 2-arg call resolves and takes the strict path',
    !strict.raised && strict.result.ok === true && strict.result.order.status === 'picked_up',
    strict.raised ? strict.message : JSON.stringify(strict.result))
}

console.log('\n\x1b[1m8. RPC and trigger agree on a no-op write\x1b[0m')
// The storage-layer trigger permits a no-op status write (it early-returns on
// IS NOT DISTINCT FROM OLD); the RPC previously rejected one. Two enforcement
// paths disagreeing is how replay semantics get ambiguous in the first place.
{
  // A genuine no-op: the order is ALREADY at the requested target.
  const order = await seed('picked_up', DRIVER_A)
  await db.exec(asUser(DRIVER_A))

  const strict = await transition(order, 'picked_up')
  ok('RPC accepts a no-op as a no-op on the strict path (alreadyApplied)',
    !strict.raised && strict.result.ok === true && strict.result.alreadyApplied === true,
    strict.raised ? strict.message : JSON.stringify(strict.result))

  // The 3-arg CAS path must agree with the 2-arg path on the same no-op.
  const cas = await transition(order, 'picked_up', 'picked_up')
  ok('CAS path also reports the no-op as alreadyApplied rather than raising',
    !cas.raised && cas.result.ok === true && cas.result.alreadyApplied === true,
    cas.raised ? cas.message : JSON.stringify(cas.result))

  // And the raw UPDATE path the trigger governs. NOTE: `affectedRows` is NOT the
  // signal here — Postgres counts a row as updated when the UPDATE matches it,
  // even if the value is identical. The signal we care about is that the trigger
  // early-returns instead of raising, so the two enforcement paths agree.
  await db.exec(`SET ROLE authenticated;`)
  let rawError = null
  let affected = null
  try {
    const raw = await db.query(
      `UPDATE public.orders SET status='picked_up' WHERE id='${order}'`)
    affected = raw.affectedRows
  } catch (e) {
    rawError = String(e.message).split('\n')[0]
  }
  await db.exec(`RESET ROLE;`)

  ok('trigger permits a no-op raw write without raising (paths agree)',
    rawError === null, `raised: ${rawError}`)
  ok('the no-op raw write left the status untouched',
    (await db.query(`SELECT status FROM public.orders WHERE id='${order}'`)
    ).rows[0].status === 'picked_up', `affectedRows=${affected}`)

  // The trigger must still REFUSE a real illegal jump. If the early-return were
  // written wrongly, this would silently pass through.
  const jump = await seed('pending', DRIVER_A)
  await db.exec(`SET ROLE authenticated;`)
  let jumpError = null
  try {
    await db.query(`UPDATE public.orders SET status='delivered' WHERE id='${jump}'`)
  } catch (e) {
    jumpError = String(e.message).split('\n')[0]
  }
  await db.exec(`RESET ROLE;`)
  const jumpStatus = (await db.query(
    `SELECT status FROM public.orders WHERE id='${jump}'`)).rows[0].status
  ok('trigger still refuses a genuine illegal jump (pending -> delivered)',
    jumpStatus === 'pending',
    jumpError ? `raised (good): ${jumpError}` : `status became ${jumpStatus} with NO error`)
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m9. One uniform no-op rule across all three enforcement paths\x1b[0m')
// The original defect was two enforcement paths disagreeing about a no-op write.
// Stating the rule once and asserting all three paths obey it is what stops that
// class of bug from creeping back:
//
//   target == current status -> no-op, report alreadyApplied (never raise)
{
  const order = await seed('picked_up', DRIVER_A)
  await db.exec(asUser(DRIVER_A))

  const strict = await transition(order, 'picked_up')
  const casSame = await transition(order, 'picked_up', 'assigned')
  const casNoop = await transition(order, 'picked_up', 'picked_up')

  ok('strict path (2-arg)      -> alreadyApplied',
    strict.result?.ok === true && strict.result.alreadyApplied === true,
    JSON.stringify(strict.result ?? strict.message))
  ok('CAS path, real replay    -> alreadyApplied',
    casSame.result?.ok === true && casSame.result.alreadyApplied === true,
    JSON.stringify(casSame.result ?? casSame.message))
  ok('CAS path, no-op assertion-> alreadyApplied',
    casNoop.result?.ok === true && casNoop.result.alreadyApplied === true,
    JSON.stringify(casNoop.result ?? casNoop.message))
  ok('none of the three paths raised',
    !strict.raised && !casSame.raised && !casNoop.raised)
  ok('the order is still picked_up after all three',
    (await db.query(`SELECT status FROM public.orders WHERE id='${order}'`)).rows[0]
      .status === 'picked_up')
}

process.exit(summary() ? 1 : 0)

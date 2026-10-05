/**
 * ROMA dispatch migration harness.
 *
 * Applies the real supabase/migrations/*.sql chain against real PostgreSQL 18
 * (PGlite = Postgres compiled to WASM), with Supabase-specific objects shimmed,
 * then exercises the dispatch layer.
 *
 * Why this exists: SQL that is only read is not verified. Building this harness
 * found four defects that reading did not (see the header of
 * 20261005120000_dispatch_core.sql and docs/DISPATCH-MIGRATION-RUNBOOK.md).
 *
 * WHAT THIS DOES NOT COVER — stated plainly so nobody over-trusts it:
 *   - Concurrency. PGlite is single-connection, so FOR UPDATE SKIP LOCKED is
 *     exercised for correctness of its WHERE clause and NOT_FOUND path, but no
 *     true two-session race is simulated. That must be tested against real
 *     Supabase with two clients before go-live.
 *   - Supabase's actual auth stack. auth.uid() is shimmed from a GUC.
 *   - PostgREST behaviour. Functions are called directly, so any wire-format
 *     ambiguity (e.g. composite return types) is not reproduced here. This is
 *     exactly why the RPCs return jsonb rather than composites.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve the repo root from this file's location so the test runs anywhere.
const REPO = fileURLToPath(new URL('../..', import.meta.url))
const MIGRATIONS = join(REPO, 'supabase/migrations')
// Migrations UNDER TEST, applied in order after the baseline so the suite can
// seed legacy data first and then prove the migrations convert it.
// Listed explicitly rather than auto-detected: a new migration silently joining
// the baseline would quietly stop being tested against legacy state.
const UNDER_TEST = [
  '20261005120000_dispatch_core.sql',
  '20261005140000_pricing_and_service_window.sql',
]

let passed = 0
const failures = []

function ok(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`)
  } else {
    failures.push(name)
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function rejects(name, sql, expectFragment) {
  try {
    await db.exec(sql)
    ok(name, false, 'statement SUCCEEDED but should have been rejected')
  } catch (e) {
    const msg = String(e.message ?? e).split('\n')[0]
    ok(name, msg.includes(expectFragment), `rejected with "${msg.slice(0, 110)}" not "${expectFragment}"`)
  }
}

process.on('uncaughtException', (e) => {
  console.error('\n\x1b[31mUNCAUGHT:\x1b[0m ' + String(e.message).split('\n')[0])
  process.exit(1)
})

const db = new PGlite()

const CUST     = '11111111-1111-1111-1111-111111111111'
const DRIVER_A = '22222222-2222-2222-2222-222222222222'
const DRIVER_B = '33333333-3333-3333-3333-333333333333'
const VENDOR   = '44444444-4444-4444-4444-444444444444'
const READY_ORDER  = 'aaaaaaaa-0000-0000-0000-000000000004'
const PENDING_ORDER = 'aaaaaaaa-0000-0000-0000-000000000001'

const asUser = (uid) => `SELECT set_config('request.jwt.claim.sub','${uid}',false);`

/** Independent JS computation of the SAST service window, to cross-check the SQL. */
function sastInWindow() {
  const t = new Date(Date.now() + 2 * 3600 * 1000)
  const dow = t.getUTCDay()
  const mins = t.getUTCHours() * 60 + t.getUTCMinutes()
  return { inWindow: dow >= 1 && dow <= 5 && mins >= 480 && mins <= 960, label: t.toISOString().slice(0, 16) }
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m1. Supabase shim\x1b[0m')
await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS storage;

  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    phone text
  );
  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text, name text, owner uuid
  );

  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END $$;

  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  END $$;
`)
console.log('  auth.uid(), anon/authenticated/service_role, supabase_realtime publication ready')

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m2. Baseline migration chain (migrations under test held back)\x1b[0m')
const baseline = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && !UNDER_TEST.includes(f))
  .sort()
for (const f of baseline) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  } catch (e) {
    console.log(`  \x1b[31mERR\x1b[0m ${f}: ${String(e.message).split('\n')[0]}`)
    process.exit(1)
  }
}
console.log(`  \x1b[32m${baseline.length} migrations applied\x1b[0m`)

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m3. Seed fixtures using the LEGACY TitleCase vocabulary\x1b[0m')
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${CUST}','cust@roma.test'), ('${DRIVER_A}','a@roma.test'),
    ('${DRIVER_B}','b@roma.test'), ('${VENDOR}','v@roma.test') ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES
    ('${DRIVER_A}','deliverer'), ('${DRIVER_B}','deliverer'),
    ('${VENDOR}','restaurant_owner') ON CONFLICT DO NOTHING;

  INSERT INTO public.restaurants (id, name, cuisine) VALUES (1,'Roma Test Kitchen','Test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.orders
    (id, customer_name, phone_number, delivery_address, restaurant_id, restaurant_name,
     subtotal, delivery_fee, total, status, user_id) VALUES
    ('${PENDING_ORDER}','Thabo M','+27612821819','12 Church St, Pretoria Central',1,'Roma Test Kitchen',100.00,15.00,115.00,'New','${CUST}'),
    ('aaaaaaaa-0000-0000-0000-000000000002','Naledi K','+27821234567','5 Lynnwood Rd',1,'Roma Test Kitchen',200.00,15.00,215.00,'Preparing','${CUST}'),
    ('aaaaaaaa-0000-0000-0000-000000000003','Sipho D','+27731112222','9 Main St, Mamelodi',1,'Roma Test Kitchen',50.00,15.00,65.00,'Delivered','${CUST}'),
    ('${READY_ORDER}','Anna P','+27745556666','3 Oak Ave, Soshanguve',1,'Roma Test Kitchen',80.00,15.00,95.00,'Ready','${CUST}');
`)
const seeded = await db.query(`SELECT status, count(*)::int n FROM public.orders GROUP BY status ORDER BY status`)
console.log('  seeded: ' + seeded.rows.map((r) => `${r.status}(${r.n})`).join(' '))

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m4. Backfill map derived from real data\x1b[0m')
const distinct = await db.query(`SELECT DISTINCT status FROM public.orders`)
const known = { New:'pending', Accepted:'accepted', Preparing:'preparing', Ready:'ready',
  'Picked Up':'picked_up', Delivered:'delivered', Cancelled:'cancelled', Failed:'failed' }
const unmapped = distinct.rows.map((r) => r.status).filter((s) => !(s in known))
ok('every live status maps to the canonical set', unmapped.length === 0, `unmapped: ${JSON.stringify(unmapped)}`)

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m5. Apply the migrations under test, in deploy order\x1b[0m')
for (const f of UNDER_TEST) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
    console.log(`  \x1b[32m ok \x1b[0m ${f}`)
  } catch (e) {
    console.log(`  \x1b[31mAPPLY FAILED\x1b[0m ${f}: ` + String(e.message).split('\n').slice(0, 3).join(' | '))
    process.exit(1)
  }
}
const after = await db.query(`SELECT status, count(*)::int n FROM public.orders GROUP BY status ORDER BY status`)
console.log('  after backfill: ' + after.rows.map((r) => `${r.status}(${r.n})`).join(' '))

console.log('\n\x1b[1m6. Backfill + default assertions\x1b[0m')
ok('"New" -> pending', (await db.query(`SELECT count(*)::int n FROM public.orders WHERE status='pending'`)).rows[0].n === 1)
ok('"Preparing" -> preparing', (await db.query(`SELECT count(*)::int n FROM public.orders WHERE status='preparing'`)).rows[0].n === 1)
ok('"Delivered" -> delivered', (await db.query(`SELECT count(*)::int n FROM public.orders WHERE status='delivered'`)).rows[0].n === 1)
ok('"Ready" -> ready', (await db.query(`SELECT count(*)::int n FROM public.orders WHERE status='ready'`)).rows[0].n === 1)
const def = await db.query(`SELECT column_default FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders' AND column_name='status'`)
ok('DEFAULT is pending (D1 — order creation would otherwise break)',
  String(def.rows[0].column_default).includes('pending'), `is ${def.rows[0].column_default}`)

// An insert that omits status must now succeed and land on 'pending'.
await db.exec(`INSERT INTO public.orders (customer_name, phone_number, delivery_address,
  restaurant_id, restaurant_name, subtotal, delivery_fee, total, user_id)
  VALUES ('Default Test','+27000000000','x',1,'Roma Test Kitchen',10,15,25,'${CUST}');`)
ok('order INSERT omitting status succeeds and defaults to pending',
  (await db.query(`SELECT status FROM public.orders WHERE customer_name='Default Test'`)).rows[0].status === 'pending')

console.log('\n\x1b[1m7. Cash-paid trigger follows the new vocabulary (D2)\x1b[0m')
await db.exec(`
  INSERT INTO public.orders (id, customer_name, phone_number, delivery_address, restaurant_id,
    restaurant_name, subtotal, delivery_fee, total, status, payment_method, payment_status, user_id)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001','Cash Cust','+27600000000','1 Test St',1,
    'Roma Test Kitchen',60.00,15.00,75.00,'pending','cash','pending','${CUST}');
  UPDATE public.orders SET status='delivered' WHERE id='bbbbbbbb-0000-0000-0000-000000000001';
`)
const cash = await db.query(`SELECT payment_status, paid_at FROM public.orders WHERE id='bbbbbbbb-0000-0000-0000-000000000001'`)
ok('cash order settles to paid on delivery', cash.rows[0].payment_status === 'paid',
  `payment_status=${cash.rows[0].payment_status} — trigger would still expect 'Delivered'`)
ok('paid_at stamped', cash.rows[0].paid_at !== null)

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m8. Service window is enforced server-side\x1b[0m')
const { inWindow, label } = sastInWindow()
const sqlWin = (await db.query(`SELECT public.is_within_service_window() w`)).rows[0].w
console.log(`  now = ${label} SAST | SQL says ${sqlWin} | independent JS says ${inWindow}`)
ok('SQL window agrees with independent JS computation', sqlWin === inWindow)

if (!inWindow) {
  await rejects(
    'claim is REFUSED outside 08:00-16:00 SAST',
    `${asUser(DRIVER_A)} SELECT public.claim_order('${READY_ORDER}');`,
    'outside_service_window'
  )
} else {
  console.log('  \x1b[33mSKIP\x1b[0m claim-refusal test (currently inside the window)')
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m9. Dispatch mechanics (window forced open — explicit test double)\x1b[0m')
console.log('  \x1b[33mNOTE\x1b[0m replacing is_within_service_window() with a constant true for')
console.log('        deterministic mechanics tests; restored in section 14 to the REAL')
console.log('        config-driven definition, not to a hardcoded copy.')
await db.exec(`CREATE OR REPLACE FUNCTION public.is_within_service_window()
  RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;`)

await db.exec(`${asUser(DRIVER_A)}`)
const claim = await db.query(`SELECT public.claim_order('${READY_ORDER}') o`)
ok('driver A claims the ready order', claim.rows[0].o.deliverer_id === DRIVER_A)
ok('claim sets status=assigned', claim.rows[0].o.status === 'assigned')
ok('claim stamps assigned_at', claim.rows[0].o.assigned_at !== null)

await rejects('driver B cannot double-claim the same order',
  `${asUser(DRIVER_B)} SELECT public.claim_order('${READY_ORDER}');`, 'order_unavailable')

await rejects('non-deliverer cannot claim',
  `${asUser(CUST)} SELECT public.claim_order('${READY_ORDER}');`, 'not_a_deliverer')

// --- deliverer lifecycle, on the order A owns ---
console.log('\n\x1b[1m10. Deliverer lifecycle: happy path AND guards\x1b[0m')
await rejects('driver cannot skip picked_up (assigned -> delivered)',
  `${asUser(DRIVER_A)} SELECT public.transition_order_status('${READY_ORDER}','delivered');`,
  'illegal_transition')

await rejects("driver B cannot touch driver A's order",
  `${asUser(DRIVER_B)} SELECT public.transition_order_status('${READY_ORDER}','picked_up');`,
  'not_your_order')

await db.exec(`${asUser(DRIVER_A)}`)
const pickedUp = await db.query(`SELECT public.transition_order_status('${READY_ORDER}','picked_up') r`)
ok('driver A CAN move assigned -> picked_up (happy path)', pickedUp.rows[0].r.status === 'picked_up')
ok('picked_up_at stamped', pickedUp.rows[0].r.picked_up_at !== null)

const delivered = await db.query(`SELECT public.transition_order_status('${READY_ORDER}','delivered') r`)
ok('driver A CAN move picked_up -> delivered (happy path)', delivered.rows[0].r.status === 'delivered')
ok('delivered_at stamped', delivered.rows[0].r.delivered_at !== null)

// The deliverer must not be able to re-open a delivered order.
await rejects('delivered is terminal for the deliverer',
  `${asUser(DRIVER_A)} SELECT public.transition_order_status('${READY_ORDER}','picked_up');`,
  'illegal_transition')

// --- actor discrimination on the vendor-only transition ---
console.log('\n\x1b[1m11. Actor discrimination\x1b[0m')
await rejects('customer cannot accept an order (vendor-only) — actor_not_permitted',
  `${asUser(CUST)} SELECT public.transition_order_status('${PENDING_ORDER}','accepted');`,
  'actor_not_permitted')

await db.exec(`${asUser(VENDOR)}`)
const accepted = await db.query(`SELECT public.transition_order_status('${PENDING_ORDER}','accepted') r`)
ok('vendor CAN accept a pending order (happy path)', accepted.rows[0].r.status === 'accepted')

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m12. Redacted job board\x1b[0m')
await db.exec(`
  INSERT INTO public.orders (id, customer_name, phone_number, delivery_address, restaurant_id,
    restaurant_name, subtotal, delivery_fee, total, status, user_id, delivery_suburb, delivery_zone)
  VALUES ('cccccccc-0000-0000-0000-000000000001','Private Person','+27829998888',
    '77 Secret Street, Unit 4',1,'Roma Test Kitchen',70.00,15.00,85.00,'ready','${CUST}',
    'Mamelodi','east');
`)
await db.exec(`${asUser(DRIVER_B)}`)
const jobs = await db.query(`SELECT * FROM public.list_open_jobs()`)
const jobCols = jobs.rows.length ? Object.keys(jobs.rows[0]) : []
console.log('  columns returned: ' + jobCols.join(', '))
const EXPECTED_JOB_COLS = ['id','restaurant_name','pickup_suburb','dropoff_suburb',
  'fee_cents','zone','created_at','age_seconds']
ok('job board returns the open job', jobs.rows.length === 1, `got ${jobs.rows.length}`)
ok('job board returns exactly the allowlisted (non-PII) columns',
  JSON.stringify(jobCols) === JSON.stringify(EXPECTED_JOB_COLS),
  `got ${JSON.stringify(jobCols)}`)
// Belt and braces: no customer-identifying column may appear under any name.
const customerPii = jobCols.filter((c) => /customer|phone|delivery_address|instruction/i.test(c))
ok('no customer-identifying column present', customerPii.length === 0, `found: ${customerPii.join(', ')}`)

// Prove the redaction by attempting to read PII as the driver directly.
const pii = await db.query(`SELECT customer_name, phone_number, delivery_address FROM public.orders`)
await db.exec(`RESET ROLE;`)
console.log(`  (raw SELECT as driver returned ${pii.rows.length} row(s) — RLS section below asserts this)`)

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m13. RLS: metadata AND live enforcement\x1b[0m')
const pol = await db.query(`
  SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname='orders' ORDER BY polname`)
for (const r of pol.rows) console.log(`  ${r.polname}\n      USING ${r.using_expr ?? '—'}`)
const unscoped = pol.rows.filter((r) => /deliverer/i.test(r.polname) && r.using_expr && !/deliverer_id/.test(r.using_expr))
ok('no deliverer policy is unscoped', unscoped.length === 0, `unscoped: ${unscoped.map((r) => r.polname).join(', ')}`)

await db.exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
`)

// Driver A has exactly one order (the one claimed then delivered).
await db.exec(`${asUser(DRIVER_A)} SET ROLE authenticated;`)
const aSees = (await db.query(`SELECT id FROM public.orders`)).rows.map((r) => r.id)
await db.exec(`RESET ROLE;`)
ok('driver A sees ONLY their own order, not all 6 (the POPIA regression test)',
  aSees.length === 1 && aSees[0] === READY_ORDER, `saw ${aSees.length}: ${aSees.join(',')}`)

await db.exec(`${asUser(DRIVER_B)} SET ROLE authenticated;`)
const bSees = (await db.query(`SELECT id FROM public.orders`)).rows.length
await db.exec(`RESET ROLE;`)
ok('driver B with no assignments sees nothing', bSees === 0, `saw ${bSees}`)

// Driver B must not be able to grab an unassigned order with a raw UPDATE.
// NOTE: RLS does not raise here — it filters the row, so the statement succeeds
// with 0 rows affected. Assert the OUTCOME (nothing changed), not an exception.
const GRAB = 'cccccccc-0000-0000-0000-000000000001'
await db.exec(`${asUser(DRIVER_B)} SET ROLE authenticated;`)
const grabRes = await db.query(
  `UPDATE public.orders SET deliverer_id='${DRIVER_B}' WHERE id='${GRAB}'`)
await db.exec(`RESET ROLE;`)
const stillUnassigned = (await db.query(
  `SELECT deliverer_id FROM public.orders WHERE id='${GRAB}'`)).rows[0].deliverer_id
ok('raw UPDATE by driver B affected 0 rows (RLS filtered it)',
  grabRes.affectedRows === 0, `affectedRows=${grabRes.affectedRows}`)
ok('order remains unassigned after the attempt', stillUnassigned === null,
  `deliverer_id=${stillUnassigned}`)

// Customer sees their own orders.
await db.exec(`${asUser(CUST)} SET ROLE authenticated;`)
const cSees = (await db.query(`SELECT id FROM public.orders`)).rows.length
await db.exec(`RESET ROLE;`)
ok('customer still sees their own orders (RLS not over-tightened)', cSees >= 5, `saw ${cSees}`)

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\n\x1b[1m13b. Raw UPDATE cannot bypass the state machine\x1b[0m')
// This is the hole the RPC alone did not close: admin, owner and deliverer
// dashboards all issue raw .update({status}). RLS permits those, so without the
// trigger a deliverer could jump assigned -> delivered and clear a delivery that
// never happened.
const RAW_ORDER = 'dddddddd-0000-0000-0000-000000000001'
await db.exec(`
  INSERT INTO public.orders (id, customer_name, phone_number, delivery_address, restaurant_id,
    restaurant_name, subtotal, delivery_fee, total, status, user_id)
  VALUES ('${RAW_ORDER}','Raw Test','+27000000001','1 Raw St',1,'Roma Test Kitchen',
    40.00,15.00,55.00,'ready','${CUST}');
`)
await db.exec(`${asUser(DRIVER_A)}`)
await db.query(`SELECT public.claim_order('${RAW_ORDER}')`)
const rawAssigned = (await db.query(`SELECT status, deliverer_id FROM public.orders WHERE id='${RAW_ORDER}'`)).rows[0]
ok('test order claimed and assigned', rawAssigned.status === 'assigned')

// Raw UPDATE as the owning driver — RLS allows the row, the trigger must refuse.
await rejects('raw UPDATE assigned -> delivered is refused by the trigger',
  `${asUser(DRIVER_A)} SET ROLE authenticated;
   UPDATE public.orders SET status='delivered' WHERE id='${RAW_ORDER}'; RESET ROLE;`,
  'illegal_status_transition')

// And a legal raw transition must still go through, so the trigger is not
// simply blocking everything.
await db.exec(`${asUser(DRIVER_A)} SET ROLE authenticated;`)
const legalRaw = await db.query(
  `UPDATE public.orders SET status='picked_up' WHERE id='${RAW_ORDER}'`)
await db.exec(`RESET ROLE;`)
ok('raw UPDATE assigned -> picked_up is permitted (legal transition)',
  legalRaw.affectedRows === 1, `affectedRows=${legalRaw.affectedRows}`)

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m14. Restore the real service window\x1b[0m')
// NOTE: section 9 replaced this function with a constant. It must be restored to
// the REAL definition from the pricing migration -- which reads service_config --
// not to a hardcoded copy. Restoring literals here would test a function shape
// that no longer exists in the codebase.
await db.exec(`
  CREATE OR REPLACE FUNCTION public.is_within_service_window()
  RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.service_config c
       WHERE EXTRACT(ISODOW FROM (now() AT TIME ZONE c.timezone))::integer = ANY (c.open_days)
         AND (now() AT TIME ZONE c.timezone)::time >= c.open_time
         AND (now() AT TIME ZONE c.timezone)::time <= c.close_time
    )
  $$;`)
const restored = (await db.query(`SELECT public.is_within_service_window() w`)).rows[0].w
ok('real config-driven window restored', restored === inWindow, `got ${restored}, expected ${inWindow}`)

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m15. Service window is CONFIGURED, not hardcoded\x1b[0m')
const cfg = (await db.query(`SELECT open_time, close_time, open_days, accept_orders_outside_window, timezone FROM public.service_config WHERE id`)).rows[0]
ok('single config row exists with the ROMA default 08:00-16:00',
  cfg && String(cfg.open_time).startsWith('08:00') && String(cfg.close_time).startsWith('16:00'),
  JSON.stringify(cfg))
ok('default trading days are Mon-Fri', JSON.stringify(cfg.open_days) === '[1,2,3,4,5]', JSON.stringify(cfg.open_days))
ok('default timezone is Africa/Johannesburg', cfg.timezone === 'Africa/Johannesburg')
ok('default refuses orders outside the window', cfg.accept_orders_outside_window === false)

// The whole point of the config table: the operator can change hours WITHOUT a
// migration. Prove the function actually reads it rather than shadowing it.
await db.exec(`UPDATE public.service_config SET open_days = '{1,2,3,4,5,6,7}', open_time='00:00', close_time='23:59' WHERE id;`)
const opened = (await db.query(`SELECT public.is_within_service_window() w`)).rows[0].w
ok('widening the config window takes effect immediately (no migration needed)',
  opened === true, `expected true with 00:00-23:59 seven days a week, got ${opened}`)

await db.exec(`UPDATE public.service_config SET open_days = '{1,2,3,4,5}', open_time='08:00', close_time='16:00' WHERE id;`)
const narrowed = (await db.query(`SELECT public.is_within_service_window() w`)).rows[0].w
ok('narrowing it back restores the original state', narrowed === inWindow, `got ${narrowed}`)

console.log('\n\x1b[1m16. service_availability() reports the next opening moment\x1b[0m')
const avail = (await db.query(`SELECT public.service_availability() s`)).rows[0].s
console.log('  ' + JSON.stringify({ isOpen: avail.isOpen, canOrder: avail.canOrder, reason: avail.reason, nextOpenAt: avail.nextOpenAt }))
ok('availability exposes isOpen', typeof avail.isOpen === 'boolean')
ok('availability exposes canOrder', typeof avail.canOrder === 'boolean')
ok('isOpen agrees with is_within_service_window()', avail.isOpen === inWindow)
ok('when closed, a next opening moment is provided', inWindow || avail.nextOpenAt !== null,
  'nextOpenAt was null while closed — the UI would have nothing to tell the customer')
if (!inWindow && avail.nextOpenAt) {
  // Recompute independently: the next opening must be a weekday at 08:00 SAST.
  const next = new Date(avail.nextOpenAt)
  const sast = new Date(next.getTime() + 2 * 3600 * 1000)
  ok('next opening is at 08:00 SAST', sast.getUTCHours() === 8 && sast.getUTCMinutes() === 0,
    `got ${sast.toISOString()}`)
  ok('next opening avoids the weekend', sast.getUTCDay() >= 1 && sast.getUTCDay() <= 5,
    `day=${sast.getUTCDay()}`)
  ok('next opening is in the future', next.getTime() > Date.now())
  // The client renders this WITHOUT a timeZone option if it forgets; assert the
  // server hands back a correct absolute instant rather than a local wall time.
  ok('nextOpenAt is an absolute instant with a timezone', /Z$|[+-]\d{2}:\d{2}$/.test(avail.nextOpenAt),
    avail.nextOpenAt)
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m17. Delivery zones (placeholder pricing, real structure)\x1b[0m')
const zones = await db.query(`SELECT code, fee_cents FROM public.delivery_zones ORDER BY sort_order`)
console.log('  ' + zones.rows.map((z) => `${z.code}=${z.fee_cents}`).join(' '))
ok('five Pretoria zones seeded', zones.rows.length === 5, `got ${zones.rows.length}`)
ok('central is the cheapest band', zones.rows.find((z) => z.code === 'central').fee_cents === 1500)
ok('north is the dearest band (farthest: Soshanguve/Mabopane)',
  zones.rows.find((z) => z.code === 'north').fee_cents === 3500)
ok('every fee is a positive integer number of cents',
  zones.rows.every((z) => Number.isInteger(z.fee_cents) && z.fee_cents > 0))

console.log('\n\x1b[1m18. quote_order() is the single pricing authority\x1b[0m')
const MI1 = 'eeeeeeee-0000-0000-0000-000000000001'
const MI2 = 'eeeeeeee-0000-0000-0000-000000000002'
const MI_OTHER = 'eeeeeeee-0000-0000-0000-000000000003'
await db.exec(`
  INSERT INTO public.restaurants (id, name, cuisine) VALUES (2,'Second Kitchen','Test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.menu_items (id, restaurant_id, name, price, category) VALUES
    ('${MI1}', 1, 'Kota',        29.99, 'Mains'),
    ('${MI2}', 1, 'Boerie Roll', 15.50, 'Mains'),
    ('${MI_OTHER}', 2, 'Rival Item', 10.00, 'Mains')
    ON CONFLICT (id) DO NOTHING;
`)

async function quote(items, zone) {
  const r = await db.query(`SELECT public.quote_order($1::jsonb, $2) q`,
    [JSON.stringify(items), zone])
  return r.rows[0].q
}

// -- exact cents arithmetic
const q = await quote([{ menuItemId: MI1, quantity: 2 }, { menuItemId: MI2, quantity: 1 }], 'central')
ok('quote succeeds for a valid single-restaurant basket', q.ok === true, JSON.stringify(q))
ok('line total is exact in cents (2 x 29.99 = 5998)', q.items[0].lineTotalCents === 5998, JSON.stringify(q.items[0]))
ok('boerie roll line is 1550', q.items[1].lineTotalCents === 1550)
ok('subtotalCents = 7548', q.subtotalCents === 7548, `got ${q.subtotalCents}`)
ok('deliveryFeeCents comes from the zone table (central=1500)', q.deliveryFeeCents === 1500)
ok('totalCents = subtotal + fee exactly', q.totalCents === q.subtotalCents + q.deliveryFeeCents)
ok('totalCents = 9048', q.totalCents === 9048, `got ${q.totalCents}`)

// -- the four-place fee problem, gone: the zone drives the price
const qNorth = await quote([{ menuItemId: MI1, quantity: 1 }], 'north')
ok('a different zone changes the fee (north=3500)', qNorth.deliveryFeeCents === 3500)
ok('north total is 29.99 + 35.00 = 6499', qNorth.totalCents === 6499, `got ${qNorth.totalCents}`)

// -- failure modes
ok('empty basket is rejected', (await quote([], 'central')).error === 'empty_basket')
ok('unknown zone is rejected', (await quote([{ menuItemId: MI1, quantity: 1 }], 'atlantis')).error === 'unknown_zone')
ok('mixed restaurants are rejected',
  (await quote([{ menuItemId: MI1, quantity: 1 }, { menuItemId: MI_OTHER, quantity: 1 }], 'central')).error === 'mixed_restaurants')
ok('unknown item is rejected',
  (await quote([{ menuItemId: '99999999-9999-9999-9999-999999999999', quantity: 1 }], 'central')).error === 'item_unavailable')
// A malformed uuid must return a clean code, not a Postgres cast error.
ok('malformed uuid returns invalid_item rather than raising',
  (await quote([{ menuItemId: 'not-a-uuid', quantity: 1 }], 'central')).error === 'invalid_item')

// -- prices come from the database, never the caller
const qTampered = await quote([{ menuItemId: MI1, quantity: 1, price: 0.01, unitPriceCents: 1 }], 'central')
ok('a client-supplied price is IGNORED (server reads menu_items)',
  qTampered.items[0].unitPriceCents === 2999 && qTampered.subtotalCents === 2999,
  `got ${qTampered.items[0].unitPriceCents}`)

// -- quantity clamping
const qClamp = await quote([{ menuItemId: MI1, quantity: 9999 }], 'central')
ok('absurd quantity is clamped to 50', qClamp.items[0].quantity === 50, `got ${qClamp.items[0].quantity}`)

console.log('\n\x1b[1m19. The four-copy fee is now one copy\x1b[0m')
// delivery_fee (numeric) must be DERIVED from delivery_fee_cents, never set
// independently, or the two can disagree on a receipt.
await db.exec(`
  INSERT INTO public.orders (customer_name, phone_number, delivery_address, restaurant_id,
    restaurant_name, subtotal, delivery_fee_cents, delivery_zone, total, status, user_id)
  VALUES ('Fee Sync','+27000000002','1 Fee St',1,'Roma Test Kitchen',100.00,1500,'central',115.00,'pending','${CUST}');
`)
const sync = (await db.query(`SELECT delivery_fee, delivery_fee_cents FROM public.orders WHERE customer_name='Fee Sync'`)).rows[0]
ok('numeric delivery_fee is derived from cents (15.00)', Number(sync.delivery_fee) === 15, `got ${sync.delivery_fee}`)

// Now write ONLY cents and confirm the numeric follows — the reverse of the old bug.
await db.exec(`
  INSERT INTO public.orders (customer_name, phone_number, delivery_address, restaurant_id,
    restaurant_name, subtotal, delivery_fee, delivery_fee_cents, delivery_zone, total, status, user_id)
  VALUES ('Fee Override','+27000000003','1 Fee St',1,'Roma Test Kitchen',100.00,99.99,3500,'north',135.00,'pending','${CUST}');
`)
const sync2 = (await db.query(`SELECT delivery_fee FROM public.orders WHERE customer_name='Fee Override'`)).rows[0]
ok('cents WIN over a stale numeric value (99.99 -> 35.00)', Number(sync2.delivery_fee) === 35, `got ${sync2.delivery_fee}`)

console.log('\n\x1b[1m20. P0 REGRESSION: order placement works with canonical status\x1b[0m')
// This mirrors EXACTLY what create-order now sends. Before the fix it sent
// status:'New' and every order failed the CHECK constraint.
await db.exec(`
  INSERT INTO public.orders (customer_name, phone_number, delivery_address, restaurant_id,
    restaurant_name, subtotal, delivery_fee_cents, delivery_zone, total, status, user_id,
    payment_method, payment_status)
  VALUES ('P0 Check','+27000000004','1 P0 St',1,'Roma Test Kitchen',
    75.48,1500,'central',90.48,'pending','${CUST}','card','pending');
`)
const p0 = (await db.query(`SELECT status FROM public.orders WHERE customer_name='P0 Check'`)).rows[0]
ok('order places successfully with status pending', p0.status === 'pending')

// And the legacy literal is still rejected, with a HELPFUL message rather than a
// bare constraint violation.
try {
  await db.exec(`INSERT INTO public.orders (customer_name, phone_number, delivery_address,
    restaurant_id, restaurant_name, subtotal, delivery_fee_cents, total, status, user_id)
    VALUES ('Legacy','+27000000005','x',1,'R',10,1500,25,'New','${CUST}');`)
  ok('legacy TitleCase status is rejected', false, 'insert SUCCEEDED')
} catch (e) {
  const msg = String(e.message)
  ok('legacy TitleCase status is rejected', msg.includes('Invalid order status'), msg.split('\n')[0])
  ok('the rejection names the canonical values', msg.includes('pending') && msg.includes('lowercase'))
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failures.length} failed\x1b[0m`)
if (failures.length) {
  console.log('\x1b[31mFailures:\x1b[0m')
  for (const f of failures) console.log('  - ' + f)
}
process.exit(failures.length ? 1 : 0)

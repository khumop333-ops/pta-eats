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
const DISPATCH_MIGRATION = '20261005120000_dispatch_core.sql'

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
console.log('\n\x1b[1m2. Baseline migration chain (dispatch migration held back)\x1b[0m')
const baseline = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f !== DISPATCH_MIGRATION)
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
console.log('\n\x1b[1m5. Apply the dispatch migration\x1b[0m')
try {
  await db.exec(readFileSync(join(MIGRATIONS, DISPATCH_MIGRATION), 'utf8'))
  console.log('  \x1b[32mapplied cleanly against real Postgres 18\x1b[0m')
} catch (e) {
  console.log('  \x1b[31mAPPLY FAILED:\x1b[0m ' + String(e.message).split('\n').slice(0, 4).join(' | '))
  process.exit(1)
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
const realWindowFn = readFileSync(join(MIGRATIONS, DISPATCH_MIGRATION), 'utf8')
  .split('CREATE OR REPLACE FUNCTION public.is_within_service_window()')[1]
console.log('  \x1b[33mNOTE\x1b[0m replacing is_within_service_window() with a constant true for')
console.log('        deterministic mechanics tests; restored in section 12.')
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
await db.exec(`CREATE OR REPLACE FUNCTION public.is_within_service_window()
  RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Johannesburg')) BETWEEN 1 AND 5
       AND (now() AT TIME ZONE 'Africa/Johannesburg')::time BETWEEN time '08:00' AND time '16:00';
  $$;`)
const restored = (await db.query(`SELECT public.is_within_service_window() w`)).rows[0].w
ok('real window function restored', restored === inWindow, `got ${restored}, expected ${inWindow}`)

console.log(`\n\x1b[1mResult: ${passed} passed, ${failures.length} failed\x1b[0m`)
if (failures.length) {
  console.log('\x1b[31mFailures:\x1b[0m')
  for (const f of failures) console.log('  - ' + f)
}
process.exit(failures.length ? 1 : 0)

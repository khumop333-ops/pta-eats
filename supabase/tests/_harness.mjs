/**
 * Shared harness for the ROMA database test suites.
 *
 * Applies the real supabase/migrations chain against real PostgreSQL 18 (PGlite =
 * Postgres compiled to WASM) with Supabase-specific objects shimmed.
 *
 * Extracted so that dispatch.test.mjs and offline-replay.test.mjs share one
 * definition of "what the test database looks like". Two divergent shims would
 * mean two different notions of truth, which is how a green suite stops meaning
 * anything.
 *
 * WHAT THIS CANNOT COVER — stated plainly so nobody over-trusts it:
 *   - Concurrency. PGlite is single-connection. FOR UPDATE SKIP LOCKED is
 *     exercised for its predicate and its NOT_FOUND path, but no true two-session
 *     race is simulated. That must be tested against real Supabase with two
 *     clients before go-live.
 *   - Supabase's actual auth stack. auth.uid() is shimmed from a session GUC.
 *   - PostgREST. Functions are called directly, so wire-format behaviour is not
 *     reproduced. This is precisely why the RPCs return jsonb, not composites.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = fileURLToPath(new URL('../..', import.meta.url))
export const MIGRATIONS = join(REPO, 'supabase/migrations')

/**
 * Migrations applied AFTER the baseline, in order, so a suite can seed legacy
 * data first and then prove a migration converts it.
 *
 * Listed explicitly rather than auto-detected: a new migration silently joining
 * the baseline would quietly stop being tested against legacy state.
 */
export const DISPATCH = '20261005120000_dispatch_core.sql'
export const PRICING = '20261005140000_pricing_and_service_window.sql'
export const OFFLINE = '20261005160000_offline_safe_transitions.sql'

export const ALL_UNDER_TEST = [DISPATCH, PRICING, OFFLINE]

/** Kill PGlite's habit of dumping its entire module graph on an uncaught throw. */
export function installCrashHandler() {
  process.on('uncaughtException', (e) => {
    console.error('\n\x1b[31mUNCAUGHT:\x1b[0m ' + String(e.message).split('\n')[0])
    process.exit(1)
  })
}

/**
 * Create a PGlite instance carrying the Supabase objects the migrations assume:
 * auth.users, storage.*, the anon/authenticated/service_role roles, the realtime
 * publication, and an auth.uid() that reads the JWT subject from a session GUC.
 */
export async function createShimmedDb() {
  const db = new PGlite()
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

    -- Mirrors supabase-js: auth.uid() is the current JWT subject, or NULL.
    -- NOTE: an earlier probe hardcoded NULL::uuid here and produced a confident,
    -- entirely wrong verdict. assertAuthShimWorks() below exists so that can
    -- never happen silently again.
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
      END IF;
    END $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
      END IF;
    END $$;
  `)
  return db
}

/**
 * Prove the auth shim actually authenticates before any test result is trusted.
 *
 * This is not ceremony. A probe built on a broken shim reported "replay is unsafe
 * because not_authenticated" — a plausible-looking, completely wrong finding. If
 * auth.uid() is not returning the expected identity, every assertion downstream is
 * meaningless, so this fails loudly and early.
 */
export async function assertAuthShimWorks(db, expectedUserId) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${expectedUserId}',false);`)
  const { rows } = await db.query(`SELECT auth.uid() AS u`)
  const actual = rows[0]?.u
  if (actual !== expectedUserId) {
    throw new Error(
      `auth shim broken: auth.uid() returned ${JSON.stringify(actual)}, ` +
        `expected ${expectedUserId}. Refusing to run tests against a shim that ` +
        `does not authenticate — every result would be meaningless.`
    )
  }
  return actual
}

/** Migration files to treat as the baseline, i.e. everything except those under test. */
export function baselineFiles(underTest) {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && !underTest.includes(f))
    .sort()
}

export function loadMigration(name) {
  return readFileSync(join(MIGRATIONS, name), 'utf8')
}

/** Apply files in order, aborting on the first failure with a readable message. */
export async function applyFiles(db, files, { label } = {}) {
  if (label) console.log(`  \x1b[1m${label}\x1b[0m`)
  for (const f of files) {
    try {
      await db.exec(loadMigration(f))
      console.log(`  \x1b[32m ok \x1b[0m ${f}`)
    } catch (e) {
      console.log(`  \x1b[31mERR\x1b[0m ${f}: ${String(e.message).split('\n')[0]}`)
      process.exit(1)
    }
  }
}

/**
 * Pass/fail reporter.
 *
 * `rejects` asserts a statement is refused AND refused for the intended reason —
 * checking only that it threw would pass on a typo in the test itself.
 */
export function makeReporter(db) {
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
      ok(
        name,
        msg.includes(expectFragment),
        `rejected with "${msg.slice(0, 120)}" not "${expectFragment}"`
      )
    }
  }

  function summary() {
    console.log(`\n\x1b[1mResult: ${passed} passed, ${failures.length} failed\x1b[0m`)
    if (failures.length) {
      console.log('\x1b[31mFailures:\x1b[0m')
      for (const f of failures) console.log('  - ' + f)
    }
    return failures.length
  }

  return { ok, rejects, summary, failures }
}

/** Grant the table privileges Supabase gives `authenticated` by default. */
export async function grantClientPrivileges(db) {
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
  `)
}

/** Act as a given user for subsequent statements. */
export const asUser = (uid) =>
  `SELECT set_config('request.jwt.claim.sub','${uid}',false);`

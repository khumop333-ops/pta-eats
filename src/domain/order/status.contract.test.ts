/**
 * Vocabulary contract test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The dispatch migration renamed the order-status vocabulary from TitleCase
 * ("New", "Delivered") to lowercase ("pending", "delivered") and added a CHECK
 * constraint. Order placement in `supabase/functions/create-order/index.ts` was
 * still writing `status: 'New'`.
 *
 * That one line meant NO CUSTOMER COULD PLACE AN ORDER. It was caught by a human
 * reading the file, not by any test — because the database suite seeds rows
 * directly and never exercises the edge function, and the TypeScript build cannot
 * see inside a Deno edge function.
 *
 * This test closes that gap. It is a static contract between the database
 * vocabulary and every file that speaks it, and it fails loudly on exactly the
 * mistake that got through.
 *
 * Comments are stripped before scanning: the migration and the edge function
 * deliberately document the old literals ("previously wrote 'New'"), and those
 * explanations are valuable, not violations.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')

/** Canonical set — mirrors src/domain/order/status.ts and orders_status_check. */
const CANONICAL = new Set([
  'pending', 'accepted', 'preparing', 'ready',
  'assigned', 'picked_up', 'delivered', 'cancelled', 'failed',
])

/** Statuses that have NEVER existed in the database. */
const PHANTOM = ['On the Way', 'Ready for Pickup/Delivery', 'PickedUp', 'Canceled']

/** TitleCase vocabulary that predates the dispatch migration. */
const LEGACY = ['New', 'Accepted', 'Preparing', 'Ready', 'Picked Up', 'Delivered', 'Cancelled', 'Failed']

/**
 * Values of a field *called* `status` that have nothing to do with orders.
 *
 * Supabase's realtime client reports the lifecycle of a channel through a
 * callback whose parameter is conventionally named `status`, so a comparison
 * such as `status !== "SUBSCRIBED"` looks exactly like an order-status write to
 * the scanner below. It is not one.
 *
 * Enumerated rather than pattern-matched because the set is small, closed and
 * defined by an external library — treating it as a fact about the world is more
 * honest than loosening the regex and silently losing the ability to catch a
 * typo like `status: "complete"`.
 */
const NON_ORDER_STATUS = new Set([
  'SUBSCRIBED',
  'TIMED_OUT',
  'CLOSED',
  'CHANNEL_ERROR',
])

/**
 * Remove comments so documentation of the old vocabulary is not flagged.
 * The `[^:]` guard keeps `https://` from being treated as a line comment.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const SOURCE_FILES = [
  ...walk(join(REPO, 'src')),
  ...walk(join(REPO, 'supabase', 'functions')),
].filter((f) => !f.endsWith('status.ts') && !f.endsWith('.test.ts'))

describe('status vocabulary contract', () => {
  it('finds source files to scan (guards against a silently empty test)', () => {
    // A path bug would make every assertion below vacuously pass. This is the
    // canary that stops this whole file from becoming decorative.
    expect(SOURCE_FILES.length).toBeGreaterThan(10)
  })

  it('no edge function or component writes a legacy TitleCase status', () => {
    const offenders: string[] = []

    for (const file of SOURCE_FILES) {
      const code = stripComments(readFileSync(file, 'utf8'))
      // Only inspect status-bearing expressions, so that an unrelated string such
      // as "Ready" in marketing copy does not produce a false positive.
      //
      // `\b` before `status` is essential: without it this also matches
      // `payment_status === "paid"`, which is a different field with different
      // values. `_` is a word character, so `\bstatus` correctly does NOT match
      // inside `payment_status` or `order_status`.
      const statusExpr = /\bstatus\s*(?::|={1,3}|!==?)\s*["']([^"']+)["']/g
      let m: RegExpExecArray | null
      while ((m = statusExpr.exec(code)) !== null) {
        const value = m[1]
        if (CANONICAL.has(value) || NON_ORDER_STATUS.has(value)) continue
        offenders.push(`${relative(REPO, file)}: status ... "${value}"`)
      }
    }

    expect(
      offenders,
      'These write a status the database will reject.\n' +
        'Use src/domain/order/status.ts. Canonical values: ' +
        [...CANONICAL].join(', ')
    ).toEqual([])
  })

  it('no source file references a phantom status that never existed', () => {
    const offenders: string[] = []

    for (const file of SOURCE_FILES) {
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const phantom of PHANTOM) {
        // Word-boundary match on any quoted occurrence.
        if (new RegExp(`["'\`]${phantom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`).test(code)) {
          offenders.push(`${relative(REPO, file)}: "${phantom}"`)
        }
      }
    }

    expect(
      offenders,
      'These statuses have never existed in the database. They cannot be ' +
        'rendered or set. Remove them rather than adding them to the constraint.'
    ).toEqual([])
  })

  it('the canonical client union matches the database CHECK constraint', () => {
    // If the constraint and the union drift, the client believes it can offer a
    // transition the server rejects — or vice versa.
    const migration = readFileSync(
      join(REPO, 'supabase', 'migrations', '20261005120000_dispatch_core.sql'),
      'utf8'
    )
    const checkBlock = migration.match(/orders_status_check CHECK \(status IN \(([\s\S]*?)\)\)/)
    expect(checkBlock, 'could not locate orders_status_check in the migration').not.toBeNull()

    const dbValues = [...checkBlock![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(dbValues).toEqual([...CANONICAL].sort())
  })

  it('the edge function writes a canonical status, not the legacy literal', () => {
    // Directly targets the P0: this exact line broke order placement.
    const fn = stripComments(
      readFileSync(join(REPO, 'supabase', 'functions', 'create-order', 'index.ts'), 'utf8')
    )
    // `\b` for the same reason as the scanner above: this must not be satisfied
    // or violated by `payment_status`.
    expect(fn).toMatch(/\bstatus:\s*['"]pending['"]/)
    expect(fn).not.toMatch(/\bstatus:\s*['"]New['"]/)
  })
})

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_STATUS_OPTIONS,
  DELIVERER_STATUS_OPTIONS,
  ORDER_STATUSES,
  OWNER_STATUS_OPTIONS,
  PAYMENT_STATUSES,
  isClaimable,
} from '@/lib/order-status';

/**
 * The order workflow is driven by free-text status columns that four separate
 * dashboards write to. Migration
 * 20261010120000_backend_hardening_constraints_and_atomic_orders.sql added CHECK
 * constraints so a typo can no longer become permanently stuck data - but a
 * constraint only helps if the UI never offers a value it would reject.
 *
 * These tests parse the migration and assert the two stay in lockstep. If you add
 * a status, add it to the migration AND to src/lib/order-status.ts.
 */

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20261010120000_backend_hardening_constraints_and_atomic_orders.sql',
);

function constraintValues(constraintName: string): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`ADD CONSTRAINT ${constraintName}`);
  expect(start, `constraint ${constraintName} missing from the migration`).toBeGreaterThan(-1);

  const inList = sql.indexOf('IN (', start);
  expect(inList, `constraint ${constraintName} is not an IN list`).toBeGreaterThan(-1);

  const close = sql.indexOf(')', inList);
  const body = sql.slice(inList + 4, close);

  return body
    .split(',')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .filter((v) => v.length > 0);
}

describe('order status values', () => {
  it('ORDER_STATUSES matches the database CHECK constraint exactly', () => {
    expect([...ORDER_STATUSES].sort()).toEqual(constraintValues('orders_status_check').sort());
  });

  it('PAYMENT_STATUSES matches the database CHECK constraint exactly', () => {
    expect([...PAYMENT_STATUSES].sort()).toEqual(
      constraintValues('orders_payment_status_check').sort(),
    );
  });

  it('payment methods match the database CHECK constraint exactly', () => {
    expect(constraintValues('orders_payment_method_check').sort()).toEqual(['card', 'cash']);
  });

  it.each([
    ['admin', ADMIN_STATUS_OPTIONS],
    ['owner', OWNER_STATUS_OPTIONS],
    ['deliverer', DELIVERER_STATUS_OPTIONS],
  ])('every status the %s dashboard can send is accepted by the database', (_role, options) => {
    expect(options.length).toBeGreaterThan(0);
    for (const status of options) {
      expect(ORDER_STATUSES, `${status} would be rejected by orders_status_check`).toContain(
        status,
      );
    }
  });

  it('has no duplicate statuses in any option list', () => {
    for (const options of [ORDER_STATUSES, ADMIN_STATUS_OPTIONS, OWNER_STATUS_OPTIONS, DELIVERER_STATUS_OPTIONS]) {
      expect(new Set(options).size).toBe(options.length);
    }
  });

  it('treats Delivered and Cancelled as unclaimable', () => {
    expect(isClaimable('Delivered')).toBe(false);
    expect(isClaimable('Cancelled')).toBe(false);
    expect(isClaimable('New')).toBe(true);
    expect(isClaimable('Accepted')).toBe(true);
  });
});

describe('atomic order creation', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('defines create_order_with_items as SECURITY DEFINER', () => {
    expect(sql).toMatch(/FUNCTION public\.create_order_with_items\([\s\S]*?SECURITY DEFINER/);
  });

  it('does not expose create_order_with_items to the API roles', () => {
    // It writes to orders/order_items, whose direct INSERT was revoked in
    // migration 20260905143434. Only the service role may call it.
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_order_with_items\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_order_with_items\([\s\S]*?\) TO service_role;/,
    );
  });

  it('takes the delivery fee from the database, not from the caller', () => {
    expect(sql).not.toMatch(/p_delivery_fee/);
    expect(sql).toMatch(/v_delivery_fee := public\.current_delivery_fee\(\);/);
  });
});

describe('deliverer claiming', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('scopes the deliverer UPDATE policy to assigned orders', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Deliverers can update orders"/);
    expect(sql).toMatch(
      /CREATE POLICY "Deliverers can update assigned orders"[\s\S]*?deliverer_id = auth\.uid\(\)/,
    );
  });

  it('claim_order requires the deliverer role and only claims unclaimed orders', () => {
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'deliverer'\)/);
    expect(sql).toMatch(/AND deliverer_id IS NULL/);
  });
});

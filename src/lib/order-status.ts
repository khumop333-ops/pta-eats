/**
 * Canonical order status and payment status values.
 *
 * These mirror the CHECK constraints added to `public.orders` in migration
 * `20261010120000_backend_hardening_constraints_and_atomic_orders.sql`. The
 * database rejects any write using a value outside these lists, so every
 * dashboard must pick from here rather than hardcoding its own strings - a typo
 * in a status label used to become permanently stuck data.
 *
 * `src/test/order-status.test.ts` fails the build if a dashboard offers a status
 * the database would reject.
 */

/** Every status the database will accept on `orders.status`. */
export const ORDER_STATUSES = [
  'New',
  'Accepted',
  'Preparing',
  'Ready',
  'Ready for Pickup/Delivery',
  'Picked Up',
  'On the Way',
  'Delivered',
  'Cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Every status the database will accept on `orders.payment_status`. */
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Statuses a super admin can move an order to from the admin dashboard. */
export const ADMIN_STATUS_OPTIONS: readonly OrderStatus[] = [
  'New',
  'Accepted',
  'Ready for Pickup/Delivery',
  'Delivered',
  'Cancelled',
] as const;

/** The kitchen/driver lifecycle a restaurant owner drives. */
export const OWNER_STATUS_OPTIONS: readonly OrderStatus[] = [
  'New',
  'Preparing',
  'Ready',
  'Picked Up',
  'On the Way',
  'Delivered',
] as const;

/** Statuses a deliverer can move a claimed order to. */
export const DELIVERER_STATUS_OPTIONS: readonly OrderStatus[] = [
  'Accepted',
  'Picked Up',
  'On the Way',
  'Delivered',
] as const;

/**
 * Whether a status still allows the order to be claimed or worked. Used to decide
 * if the deliverer dashboard should offer a "Claim" action.
 */
export function isClaimable(status: string): boolean {
  return status !== 'Delivered' && status !== 'Cancelled';
}

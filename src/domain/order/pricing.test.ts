/**
 * Unit tests for the pricing presentation layer.
 *
 * These run with zero mocks — no Supabase client, no React, no network — which is
 * the entire reason src/domain/ is pure. If a test here ever needs a mock, the
 * module has picked up an unwanted dependency.
 *
 * Note what is deliberately NOT tested: totals. The client does not compute them,
 * so there is nothing to test. Those are covered by the database suite in
 * supabase/tests/dispatch.test.mjs against real Postgres.
 */
import { describe, expect, it } from 'vitest'
import {
  type ServiceAvailability,
  closedMessage,
  describeOpenDays,
  formatZAR,
  quoteErrorMessage,
} from './pricing'

describe('formatZAR', () => {
  it('formats cents as rands with a comma decimal separator', () => {
    // South African convention. The previous UI used toFixed(2) — a period —
    // which reads as a thousands separator locally.
    expect(formatZAR(1500)).toBe('R 15,00')
    expect(formatZAR(12345)).toBe('R 123,45')
    expect(formatZAR(0)).toBe('R 0,00')
    expect(formatZAR(5)).toBe('R 0,05')
    expect(formatZAR(99)).toBe('R 0,99')
  })

  it('groups thousands with spaces', () => {
    expect(formatZAR(100000)).toBe('R 1 000,00')
    expect(formatZAR(123456789)).toBe('R 1 234 567,89')
  })

  it('never loses a cent to floating point', () => {
    // The reason all money is integer cents. The old code did
    // Math.round(x*100)/100 on floats; 0.1+0.2 style drift is how a receipt ends
    // up one cent off and someone has to explain it.
    expect(formatZAR(10 + 20)).toBe('R 0,30')
    expect(formatZAR(1)).toBe('R 0,01')
    // A large order: 999 items at R 19,99
    expect(formatZAR(999 * 1999)).toBe('R 19 970,01')
  })

  it('handles negatives and non-finite input without crashing the UI', () => {
    expect(formatZAR(-1500)).toBe('-R 15,00')
    expect(formatZAR(Number.NaN)).toBe('R —')
    expect(formatZAR(Number.POSITIVE_INFINITY)).toBe('R —')
  })
})

describe('describeOpenDays', () => {
  it('describes the default Mon-Fri week', () => {
    expect(describeOpenDays([1, 2, 3, 4, 5])).toBe('Monday to Friday')
  })

  it('describes a full week and an empty week', () => {
    expect(describeOpenDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day')
    expect(describeOpenDays([])).toBe('Closed')
    expect(describeOpenDays(undefined)).toBe('Closed')
  })

  it('lists non-consecutive days rather than inventing a range', () => {
    // Mon/Wed/Fri must not be rendered as "Monday to Friday" — that would
    // promise Tuesday delivery the business does not offer.
    expect(describeOpenDays([1, 3, 5])).toBe('Monday, Wednesday, Friday')
  })

  it('does not conflate a two-day week with a range', () => {
    // Sat+Sun is consecutive but "Saturday to Sunday" reads worse than listing.
    expect(describeOpenDays([6, 7])).toBe('Saturday, Sunday')
  })

  it('is order-insensitive', () => {
    expect(describeOpenDays([5, 4, 3, 2, 1])).toBe('Monday to Friday')
  })
})

describe('closedMessage', () => {
  const base: ServiceAvailability = {
    isOpen: false,
    canOrder: false,
    reason: 'closed',
    opensAt: null,
    closesAt: null,
    nextOpenAt: null,
    timezone: 'Africa/Johannesburg',
  }

  it('returns null when ordering is possible, so callers need no branch', () => {
    expect(closedMessage({ ...base, isOpen: true, canOrder: true, reason: 'open' })).toBeNull()
    // Closed but the operator opted into accepting orders anyway.
    expect(
      closedMessage({ ...base, canOrder: true, reason: 'closed_but_accepting' })
    ).toBeNull()
  })

  it('names the next opening moment when one is known', () => {
    // 2026-10-05 is a Monday. 08:00 SAST == 06:00 UTC.
    const msg = closedMessage({
      ...base,
      nextOpenAt: '2026-10-05T06:00:00.000Z',
      timezone: 'Africa/Johannesburg',
    })
    expect(msg).toContain("We're closed right now")
    expect(msg).toContain('Monday')
    expect(msg).toContain('08:00')
  })

  it('falls back to stating the trading hours when the moment is unknown', () => {
    const msg = closedMessage({
      ...base,
      openDays: [1, 2, 3, 4, 5],
      openTime: '08:00',
      closeTime: '16:00',
    })
    expect(msg).toContain('Monday to Friday')
    expect(msg).toContain('08:00')
    expect(msg).toContain('16:00')
  })

  it('does not render "Invalid Date" at the customer', () => {
    const msg = closedMessage({ ...base, nextOpenAt: 'not-a-timestamp', openDays: [1, 2, 3, 4, 5] })
    expect(msg).not.toContain('Invalid')
    expect(msg).toContain('Monday to Friday')
  })
})

describe('quoteErrorMessage', () => {
  it('has copy for every error code the database can return', () => {
    // If quote_order() gains a new failure reason, the Record type forces a
    // compile error here rather than a blank toast in production.
    expect(quoteErrorMessage({ ok: false, error: 'item_unavailable' })).toMatch(/no longer available/i)
    expect(quoteErrorMessage({ ok: false, error: 'mixed_restaurants' })).toMatch(/one restaurant/i)
    expect(quoteErrorMessage({ ok: false, error: 'unknown_zone' })).toMatch(/don't deliver/i)
  })
})

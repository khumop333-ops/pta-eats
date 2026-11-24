import { beforeEach, describe, expect, it } from "vitest";
import { DELIVERY_FEE, MAGWINYA_ZONE_DELIVERY_FEE, getRestaurantDeliveryFee } from "./business";
import {
  REFERRAL_MAX_AGE_MS,
  REFERRAL_STORAGE_KEY,
  buildReferralShareUrl,
  buildReferralWhatsAppInviteLink,
  clearStoredReferralCode,
  normalizeReferralCode,
  parseOrderPromoResult,
  readStoredReferralCode,
  saveReferralCode,
} from "./referrals";

describe("per-restaurant delivery fees", () => {
  it("charges R15 for Magwinya Zone and R20 for other restaurants by default", () => {
    expect(MAGWINYA_ZONE_DELIVERY_FEE).toBe(15);
    expect(DELIVERY_FEE).toBe(20);

    expect(getRestaurantDeliveryFee({ slug: "magwinya-zone" })).toBe(15);
    expect(getRestaurantDeliveryFee({ name: "Magwinya Zone" })).toBe(15);
    expect(getRestaurantDeliveryFee({ slug: "sheamus" })).toBe(20);
    expect(getRestaurantDeliveryFee({ slug: "thuba-rush" })).toBe(20);
    expect(getRestaurantDeliveryFee({ slug: "ko-kgorong" })).toBe(20);
    expect(getRestaurantDeliveryFee()).toBe(20);
  });

  it("honours an explicit delivery_fee from the database when provided", () => {
    expect(getRestaurantDeliveryFee({ slug: "magwinya-zone", deliveryFee: 15 })).toBe(15);
    expect(getRestaurantDeliveryFee({ slug: "sheamus", deliveryFee: "25.00" })).toBe(25);
    expect(getRestaurantDeliveryFee({ slug: "promo-kitchen", deliveryFee: 0 })).toBe(0);
  });
});

describe("referral code helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalises valid referral codes and rejects malformed strings", () => {
    expect(normalizeReferralCode("  roma-7k3p9x  ")).toBe("ROMA-7K3P9X");
    expect(normalizeReferralCode("ab")).toBe("");
    expect(normalizeReferralCode(null)).toBe("");
  });

  it("persists and expires stored referral codes", () => {
    expect(saveReferralCode("roma-abc123")).toBe("ROMA-ABC123");
    expect(readStoredReferralCode()).toBe("ROMA-ABC123");

    window.localStorage.setItem(
      REFERRAL_STORAGE_KEY,
      JSON.stringify({ code: "ROMA-OLD123", savedAt: Date.now() - REFERRAL_MAX_AGE_MS - 1000 }),
    );
    expect(readStoredReferralCode()).toBe("");

    saveReferralCode("ROMA-NEW123");
    clearStoredReferralCode();
    expect(readStoredReferralCode()).toBe("");
  });

  it("builds shareable signup URLs and WhatsApp invite links", () => {
    expect(buildReferralShareUrl("roma-7k3p9x", "https://roma.africa/")).toBe(
      "https://roma.africa/auth?mode=signup&ref=ROMA-7K3P9X",
    );

    const waLink = buildReferralWhatsAppInviteLink("roma-7k3p9x", "https://roma.africa");
    const decoded = decodeURIComponent(waLink.split("?text=")[1] ?? "");
    expect(decoded).toContain("FIRST DELIVERY FREE");
    expect(decoded).toContain("https://roma.africa/auth?mode=signup&ref=ROMA-7K3P9X");
    expect(decoded).toContain("ROMA-7K3P9X");
  });

  it("parses order promo RPC responses", () => {
    expect(
      parseOrderPromoResult({
        redeemed: true,
        promo_code: "FD-123ABC",
        saved_amount: 15,
        remaining_credits: 0,
        referral_rewarded: true,
      }),
    ).toEqual({
      redeemed: true,
      promoCode: "FD-123ABC",
      savedAmount: 15,
      remainingCredits: 0,
      referralRewarded: true,
    });
  });
});

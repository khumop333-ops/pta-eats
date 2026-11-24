export const REFERRAL_STORAGE_KEY = "roma-referral-code-v1";
export const REFERRAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredReferral = {
  code: string;
  savedAt: number;
};

export function normalizeReferralCode(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return cleaned.length >= 4 && cleaned.length <= 24 ? cleaned : "";
}

export function saveReferralCode(raw: string | null | undefined): string {
  const code = normalizeReferralCode(raw);
  if (!code) return "";
  if (typeof window === "undefined" || !window.localStorage) return code;

  try {
    const payload: StoredReferral = { code, savedAt: Date.now() };
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private mode / storage quota: ignore cleanly.
  }

  return code;
}

export function readStoredReferralCode(): string {
  if (typeof window === "undefined" || !window.localStorage) return "";

  try {
    const raw = window.localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    if (typeof parsed.code !== "string" || typeof parsed.savedAt !== "number") {
      window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return "";
    }
    if (Date.now() - parsed.savedAt > REFERRAL_MAX_AGE_MS) {
      window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return "";
    }
    return normalizeReferralCode(parsed.code);
  } catch {
    return "";
  }
}

export function clearStoredReferralCode(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function buildReferralShareUrl(
  referralCode: string,
  origin: string = typeof window !== "undefined" ? window.location.origin : "https://roma.africa",
): string {
  const code = normalizeReferralCode(referralCode);
  const base = origin.replace(/\/+$/, "");
  return code ? `${base}/auth?mode=signup&ref=${encodeURIComponent(code)}` : `${base}/auth?mode=signup`;
}

export function buildReferralWhatsAppInviteLink(
  referralCode: string,
  origin?: string,
): string {
  const shareUrl = buildReferralShareUrl(referralCode, origin);
  const code = normalizeReferralCode(referralCode);
  const message = [
    "Hey! Order local favourites in Pretoria Central on Roma and get your FIRST DELIVERY FREE when you sign up with my link:",
    shareUrl,
    code ? `(Referral code: ${code})` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export type OrderPromoResult = {
  redeemed: boolean;
  promoCode: string | null;
  savedAmount: number;
  remainingCredits: number;
  referralRewarded: boolean;
};

export function parseOrderPromoResult(data: unknown): OrderPromoResult | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return {
    redeemed: Boolean(record.redeemed),
    promoCode: typeof record.promo_code === "string" && record.promo_code.trim() ? record.promo_code.trim() : null,
    savedAmount: typeof record.saved_amount === "number" ? record.saved_amount : Number(record.saved_amount ?? 0) || 0,
    remainingCredits:
      typeof record.remaining_credits === "number"
        ? record.remaining_credits
        : Number(record.remaining_credits ?? 0) || 0,
    referralRewarded: Boolean(record.referral_rewarded),
  };
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  Loader2,
  MessageCircle,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  buildReferralShareUrl,
  buildReferralWhatsAppInviteLink,
  normalizeReferralCode,
} from "@/lib/referrals";
import { openWhatsApp } from "@/lib/whatsapp";
import StorefrontPageHeader from "@/components/storefront/StorefrontPageHeader";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";

type ReferralRow = Tables<"referrals">;
type RedemptionRow = Tables<"delivery_credit_redemptions">;

const formatRand = (value: number) => `R ${Number(value).toFixed(2)}`;

const ReferralsPage = () => {
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [copiedItem, setCopiedItem] = useState<"link" | "code" | null>(null);
  const [friendCode, setFriendCode] = useState("");
  const [applyingCode, setApplyingCode] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Free Delivery & Referrals — Roma";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const loadActivity = useCallback(async () => {
    if (!user) {
      setReferrals([]);
      setRedemptions([]);
      return;
    }

    setLoadingData(true);
    try {
      const [referralsRes, redemptionsRes] = await Promise.all([
        supabase
          .from("referrals")
          .select("*")
          .eq("referrer_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("delivery_credit_redemptions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (!referralsRes.error) {
        setReferrals(referralsRes.data ?? []);
      }
      if (!redemptionsRes.error) {
        setRedemptions(redemptionsRes.data ?? []);
      }
    } catch {
      // Gracefully degrade if tables aren't reachable yet.
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const credits = Math.max(0, profile?.free_delivery_credits ?? 0);
  const referralCode = profile?.referral_code?.trim() || "";
  const shareUrl = referralCode ? buildReferralShareUrl(referralCode) : "";
  const canAddFriendCode =
    Boolean(user) &&
    !profile?.referred_by_user_id &&
    (profile?.orders_placed_count ?? 0) === 0;

  const rewardedCount = referrals.filter((r) => r.status === "rewarded").length;
  const pendingCount = referrals.filter((r) => r.status === "pending_first_order").length;

  const copyValue = async (kind: "link" | "code", value: string) => {
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopiedItem(kind);
      toast.success(kind === "link" ? "Referral link copied!" : "Referral code copied!");
      setTimeout(() => setCopiedItem(null), 2500);
    } catch {
      toast.error("Couldn't copy automatically — please select and copy it.");
    }
  };

  const handleApplyFriendCode = async (event: FormEvent) => {
    event.preventDefault();
    const cleaned = normalizeReferralCode(friendCode);
    if (!cleaned) {
      toast.error("Please enter a valid referral code.");
      return;
    }

    setApplyingCode(true);
    try {
      const { data, error } = await supabase.rpc("apply_referral_code", {
        p_referral_code: cleaned,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        toast.error(result?.error || "Could not apply referral code.");
        return;
      }

      toast.success("Referral code linked! Your friend will earn a free delivery when you send your first order.");
      setFriendCode("");
      await refreshProfile();
      await loadActivity();
    } finally {
      setApplyingCode(false);
    }
  };

  return (
    <div className="roma-surface flex min-h-screen flex-col">
      <StorefrontPageHeader backTo="/r" backLabel="Browse restaurants" />

      <main className="container mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-14">
        <p className="roma-eyebrow">Roma delivery campaign</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-foreground md:text-5xl">
          Free First Delivery & Referral Rewards
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Sign up to get your first delivery completely FREE, then invite friends to Roma to keep earning free deliveries across Pretoria Central.
        </p>

        {/* How it works 3-step cards */}
        <section aria-label="How free deliveries work" className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="roma-card p-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Gift aria-hidden="true" className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
              1. Sign up, get 1st delivery free
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Every new Roma account starts with 1 free delivery credit — automatically applied at checkout so you pay R0 delivery on your first order.
            </p>
          </div>

          <div className="roma-card p-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/12 text-secondary">
              <Users aria-hidden="true" className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
              2. Share your link with friends
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Send your personal referral link or code on WhatsApp. Your friends also get their first delivery free when they create an account.
            </p>
          </div>

          <div className="roma-card p-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/25 text-foreground">
              <Truck aria-hidden="true" className="h-5 w-5 text-primary" />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
              3. Earn 1 free delivery per friend
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              As soon as your referred friend sends their first order, 1 free delivery credit is added straight to your account.
            </p>
          </div>
        </section>

        {authLoading ? (
          <div className="roma-card mt-8 flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" />
            Checking your account…
          </div>
        ) : !user ? (
          <section className="roma-card mt-8 border-primary/25 bg-gradient-to-br from-primary/10 via-card to-accent/15 p-6 text-center md:p-10">
            <Sparkles aria-hidden="true" className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-3 font-display text-2xl font-bold text-foreground md:text-3xl">
              Ready for your free first delivery?
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              Create your free Roma account in under 30 seconds to unlock R0 delivery on your first order and get your personal referral link.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link to="/auth?mode=signup" state={{ from: "/referrals" }}>
                  <Gift aria-hidden="true" className="h-4 w-4" />
                  Create account & get free delivery
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth" state={{ from: "/referrals" }}>
                  Sign in to existing account
                </Link>
              </Button>
            </div>
          </section>
        ) : (
          <div className="mt-8 space-y-6">
            {/* Credit Balance & Share Link Grid */}
            <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <section className="roma-card flex flex-col justify-between border-primary/25 bg-gradient-to-br from-primary/12 via-card to-accent/15 p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Available balance
                  </p>
                  <p className="mt-3 font-display text-5xl font-bold text-foreground">
                    {credits}
                  </p>
                  <p className="mt-1 font-medium text-foreground">
                    Free {credits === 1 ? "delivery credit" : "delivery credits"}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {credits > 0
                      ? "Automatically applied on your next checkout — R0 delivery fee!"
                      : "Refer a friend below to earn your next free delivery."}
                  </p>
                </div>

                <Button asChild className="mt-6 w-full gap-2">
                  <Link to="/r">
                    Order now <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </Button>
              </section>

              <section className="roma-card p-6">
                <h2 className="font-display text-xl font-bold text-foreground">
                  Your Personal Referral Link
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Share this link or code with friends. Once they sign up and place their first order, you get 1 free delivery.
                </p>

                {referralCode ? (
                  <div className="mt-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Your referral code
                        </p>
                        <p className="mt-0.5 font-mono text-lg font-bold tracking-wider text-foreground">
                          {referralCode}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copyValue("code", referralCode)}
                        className="gap-1.5"
                      >
                        {copiedItem === "code" ? (
                          <Check aria-hidden="true" className="h-4 w-4" />
                        ) : (
                          <Copy aria-hidden="true" className="h-4 w-4" />
                        )}
                        {copiedItem === "code" ? "Copied" : "Copy code"}
                      </Button>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        readOnly
                        value={shareUrl}
                        aria-label="Your shareable referral link"
                        className="bg-muted/30 font-mono text-xs sm:text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void copyValue("link", shareUrl)}
                        className="shrink-0 gap-1.5"
                      >
                        {copiedItem === "link" ? (
                          <Check aria-hidden="true" className="h-4 w-4" />
                        ) : (
                          <Copy aria-hidden="true" className="h-4 w-4" />
                        )}
                        {copiedItem === "link" ? "Link copied!" : "Copy link"}
                      </Button>
                    </div>

                    <Button
                      type="button"
                      size="lg"
                      onClick={() => openWhatsApp(buildReferralWhatsAppInviteLink(referralCode))}
                      className="w-full gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 sm:w-auto"
                    >
                      <MessageCircle aria-hidden="true" className="h-4 w-4" />
                      Share invite on WhatsApp
                    </Button>
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                    Your referral code will appear here automatically once your account profile finishes syncing.
                  </p>
                )}
              </section>
            </div>

            {/* Optional: link a friend's referral code if user hasn't placed first order yet */}
            {canAddFriendCode ? (
              <section className="roma-card p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Were you referred by a friend?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  If you forgot to enter a friend’s referral code when signing up, you can still link it here before your first order.
                </p>
                <form onSubmit={(e) => void handleApplyFriendCode(e)} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="friendReferralCode">Friend’s referral code</Label>
                    <Input
                      id="friendReferralCode"
                      value={friendCode}
                      onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                      placeholder="e.g. ROMA-7K3P9X"
                    />
                  </div>
                  <Button type="submit" disabled={applyingCode}>
                    {applyingCode ? "Linking…" : "Apply code"}
                  </Button>
                </form>
              </section>
            ) : null}

            {/* Referral stats & history */}
            <section className="roma-card p-6" aria-labelledby="referral-history-heading">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 id="referral-history-heading" className="font-display text-xl font-bold text-foreground">
                    Your Referrals
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Track friends who joined with your link and when your free deliveries unlock.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-muted px-3 py-1 text-foreground">
                    {referrals.length} joined
                  </span>
                  <span className="rounded-full bg-secondary/15 px-3 py-1 text-secondary">
                    {pendingCount} awaiting 1st order
                  </span>
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-primary">
                    {rewardedCount} free {rewardedCount === 1 ? "delivery" : "deliveries"} earned
                  </span>
                </div>
              </div>

              {loadingData ? (
                <p className="mt-6 text-sm text-muted-foreground">Loading referrals…</p>
              ) : referrals.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-6 text-center">
                  <Users aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-2 text-sm font-medium text-foreground">No referrals yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Share your referral link above on WhatsApp to start earning free deliveries!
                  </p>
                </div>
              ) : (
                <ul className="mt-5 divide-y divide-border">
                  {referrals.map((ref) => (
                    <li key={ref.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {ref.referred_name || "Friend on Roma"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Joined {new Date(ref.created_at).toLocaleDateString("en-ZA")}
                        </p>
                      </div>
                      {ref.status === "rewarded" ? (
                        <Badge className="gap-1 bg-primary text-primary-foreground">
                          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                          +1 Free delivery earned
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                          Awaiting 1st order
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Redemption history */}
            {redemptions.length > 0 ? (
              <section className="roma-card p-6" aria-labelledby="redemptions-heading">
                <h2 id="redemptions-heading" className="font-display text-xl font-bold text-foreground">
                  Recent Free Deliveries Used
                </h2>
                <ul className="mt-4 divide-y divide-border">
                  {redemptions.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div>
                        <p className="font-medium text-foreground">{item.restaurant_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Code <span className="font-mono font-semibold text-foreground">{item.promo_code}</span> ·{" "}
                          {new Date(item.created_at).toLocaleDateString("en-ZA")}
                        </p>
                      </div>
                      <span className="font-semibold text-primary">
                        Saved {formatRand(item.saved_amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </main>

      <StorefrontFooter />
    </div>
  );
};

export default ReferralsPage;

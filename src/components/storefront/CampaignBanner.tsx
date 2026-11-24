import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, Copy, Gift, MessageCircle, Sparkles, Truck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { buildReferralShareUrl, buildReferralWhatsAppInviteLink } from "@/lib/referrals";
import { openWhatsApp } from "@/lib/whatsapp";

type CampaignBannerProps = {
  variant?: "full" | "compact";
};

const CampaignBanner = ({ variant = "full" }: CampaignBannerProps) => {
  const { user, profile } = useAuth();
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  const credits = Math.max(0, profile?.free_delivery_credits ?? 0);
  const referralCode = profile?.referral_code?.trim() || "";

  const handleCopyReferral = async () => {
    if (!referralCode) return;
    const shareUrl = buildReferralShareUrl(referralCode);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy automatically — open Referrals to copy your code.");
    }
  };

  const handleShareWhatsApp = () => {
    if (!referralCode) return;
    openWhatsApp(buildReferralWhatsAppInviteLink(referralCode));
  };

  if (variant === "compact") {
    return (
      <section
        aria-label="Free delivery promotions"
        className="roma-card border-primary/20 bg-gradient-to-r from-primary/10 via-accent/15 to-card p-4 md:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Gift aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              {user ? (
                <>
                  <p className="font-semibold text-foreground">
                    {credits > 0
                      ? `You have ${credits} free ${credits === 1 ? "delivery" : "deliveries"} ready!`
                      : "Refer friends & earn free deliveries"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {credits > 0
                      ? "Automatically applied at checkout — plus earn more when friends place their first order."
                      : "Share your Roma link and get 1 free delivery each time a friend places their first order."}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-foreground">
                    Sign up & get your first delivery FREE
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Create a free account for R0 delivery on your 1st order, plus earn free deliveries when you refer friends.
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {user ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/referrals">Refer & earn</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm">
                  <Link to="/auth?mode=signup" state={{ from: location.pathname }}>
                    Claim free delivery
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/referrals">Referral program</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="campaign-heading"
      className="container mx-auto max-w-6xl px-4 pt-10 md:pt-14"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Card 1: Sign up & get first delivery free (or active credit status for signed-in users) */}
        <div className="roma-card relative overflow-hidden border-primary/25 bg-gradient-to-br from-primary/12 via-card to-accent/15 p-6 md:p-7">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Truck aria-hidden="true" className="h-3.5 w-3.5" />
            {user ? "Your delivery perks" : "Welcome offer"}
          </div>

          {user ? (
            <>
              <h2 id="campaign-heading" className="mt-3 font-display text-2xl font-bold text-foreground md:text-3xl">
                {credits > 0
                  ? `${credits} Free ${credits === 1 ? "Delivery" : "Deliveries"} Ready to Use`
                  : "All Caught Up on Free Deliveries"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">
                {credits > 0
                  ? "Your free delivery credit will automatically be applied at checkout — R0 delivery on your next order!"
                  : "Want your next delivery on the house? Share your referral link and get 1 free delivery when a friend places their first order."}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button asChild className="gap-2">
                  <Link to="/r">
                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                    Order now
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/referrals">View my credits</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 id="campaign-heading" className="mt-3 font-display text-2xl font-bold text-foreground md:text-3xl">
                Sign Up & Get Your First Delivery for Free.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">
                Create a free Roma account in seconds and pay <span className="font-semibold text-foreground">R0 delivery</span> on your first order from any kitchen in Pretoria Central.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button asChild className="gap-2">
                  <Link to="/auth?mode=signup" state={{ from: location.pathname }}>
                    <Gift aria-hidden="true" className="h-4 w-4" />
                    Sign up for free delivery
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link to="/r">Browse menus first</Link>
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Card 2: Referral program */}
        <div className="roma-card relative overflow-hidden border-secondary/20 bg-gradient-to-br from-secondary/10 via-card to-muted/50 p-6 md:p-7">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-secondary">
            <Users aria-hidden="true" className="h-3.5 w-3.5" />
            Referral program
          </div>

          <h3 className="mt-3 font-display text-2xl font-bold text-foreground md:text-3xl">
            Refer Friends, Get Free Deliveries.
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">
            Invite friends to Roma. They get their first delivery free when they sign up, and{" "}
            <span className="font-semibold text-foreground">you earn 1 free delivery</span> as soon as they send their first order.
          </p>

          {user && referralCode ? (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Button type="button" onClick={handleShareWhatsApp} className="gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/90">
                <MessageCircle aria-hidden="true" className="h-4 w-4" />
                Invite on WhatsApp
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleCopyReferral()} className="gap-1.5">
                {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                {copied ? "Copied!" : `Copy link (${referralCode})`}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/referrals">Track referrals</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button asChild variant="secondary" className="gap-2">
                <Link to={user ? "/referrals" : "/auth?mode=signup"}>
                  <Users aria-hidden="true" className="h-4 w-4" />
                  {user ? "Open referral dashboard" : "Get your referral link"}
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/referrals">How it works</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default CampaignBanner;

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Gift, Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RedemptionRow = Tables<"delivery_credit_redemptions">;
type ReferralRow = Tables<"referrals">;
type ProfileSummary = Pick<Tables<"profiles">, "id" | "full_name" | "referral_code" | "free_delivery_credits">;

const PromoReferralManager = () => {
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, ProfileSummary>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [redemptionsRes, referralsRes, profilesRes] = await Promise.all([
        supabase
          .from("delivery_credit_redemptions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("referrals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("profiles")
          .select("id, full_name, referral_code, free_delivery_credits"),
      ]);

      if (!redemptionsRes.error) {
        setRedemptions(redemptionsRes.data ?? []);
      }
      if (!referralsRes.error) {
        setReferrals(referralsRes.data ?? []);
      }
      if (!profilesRes.error) {
        const map = new Map<string, ProfileSummary>();
        for (const p of profilesRes.data ?? []) {
          map.set(p.id, p);
        }
        setProfilesById(map);
      }
      setLoading(false);
    };

    void load();
  }, []);

  const filteredRedemptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return redemptions;
    return redemptions.filter(
      (r) =>
        r.promo_code.toLowerCase().includes(q) ||
        (r.customer_name || "").toLowerCase().includes(q) ||
        (r.customer_phone || "").toLowerCase().includes(q) ||
        r.restaurant_name.toLowerCase().includes(q),
    );
  }, [redemptions, searchQuery]);

  const totalSaved = useMemo(
    () => redemptions.reduce((sum, r) => sum + Number(r.saved_amount), 0),
    [redemptions],
  );
  const rewardedReferrals = useMemo(
    () => referrals.filter((r) => r.status === "rewarded").length,
    [referrals],
  );

  return (
    <div className="space-y-8">
      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Free deliveries redeemed
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-foreground">
            {redemptions.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total customer savings: R {totalSaved.toFixed(2)}
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Referred sign-ups
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-foreground">
            {referrals.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {rewardedReferrals} completed 1st order · {referrals.length - rewardedReferrals} pending
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Registered accounts
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-foreground">
            {profilesById.size}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Welcome 1st delivery + referral campaign
          </p>
        </div>
      </div>

      {/* Verify WhatsApp FD-XXXXXX Promo Codes */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
              <Gift className="h-5 w-5 text-primary" />
              Free Delivery Verification Codes
            </h2>
            <p className="text-sm text-muted-foreground">
              Match any <span className="font-mono font-semibold">FD-XXXXXX</span> code from a customer’s WhatsApp order.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search FD- code, name or phone…"
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading promo redemptions…</p>
        ) : filteredRedemptions.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            {searchQuery.trim()
              ? `No free delivery redemption matches “${searchQuery.trim()}”.`
              : "No free delivery credits have been redeemed yet."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Promo Code</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Restaurant</TableHead>
                  <TableHead>Order Subtotal</TableHead>
                  <TableHead>Fee Saved</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRedemptions.map((item) => {
                  const prof = profilesById.get(item.user_id);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono font-bold text-primary">
                        {item.promo_code}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {item.customer_name || prof?.full_name || "Customer"}
                        </p>
                        {item.customer_phone ? (
                          <p className="text-xs text-muted-foreground">{item.customer_phone}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.restaurant_name}</TableCell>
                      <TableCell>R {Number(item.order_subtotal).toFixed(2)}</TableCell>
                      <TableCell className="font-semibold text-primary">
                        R {Number(item.saved_amount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleString("en-ZA")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Referrals Table */}
      <section className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
            <Users className="h-5 w-5 text-secondary" />
            Referral Activity
          </h2>
          <p className="text-sm text-muted-foreground">
            Referrers earn +1 free delivery credit once their referred friend completes their first order.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading referrals…</p>
        ) : referrals.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No referrals recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Referred Friend</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed Up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.map((ref) => {
                  const referrer = profilesById.get(ref.referrer_id);
                  const referred = profilesById.get(ref.referred_user_id);
                  return (
                    <TableRow key={ref.id}>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {referrer?.full_name || ref.referrer_id.slice(0, 8)}
                        </p>
                        {referrer?.referral_code ? (
                          <p className="font-mono text-xs text-muted-foreground">
                            {referrer.referral_code}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {referred?.full_name || ref.referred_name || ref.referred_user_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        {ref.status === "rewarded" ? (
                          <Badge className="gap-1 bg-primary text-primary-foreground">
                            <CheckCircle2 className="h-3 w-3" /> Rewarded (+1 credit)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" /> Awaiting 1st order
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(ref.created_at).toLocaleString("en-ZA")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PromoReferralManager;

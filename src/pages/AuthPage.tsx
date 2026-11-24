import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Gift, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { getAuthReturnPath } from "@/lib/authRedirect";
import {
  clearStoredReferralCode,
  normalizeReferralCode,
  readStoredReferralCode,
  saveReferralCode,
} from "@/lib/referrals";

const AuthPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = getAuthReturnPath(location.state);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlRef = searchParams.get("ref");
  const modeParam = searchParams.get("mode");

  const initialReferralCode = useMemo(() => {
    if (urlRef) return saveReferralCode(urlRef);
    return readStoredReferralCode();
  }, [urlRef]);

  const [isSignUp, setIsSignUp] = useState(() => modeParam === "signup" || Boolean(urlRef));
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    fullName: "",
    referralCode: initialReferralCode,
  });

  useEffect(() => {
    if (modeParam === "signup" || urlRef) {
      setIsSignUp(true);
    }
    if (urlRef) {
      const saved = saveReferralCode(urlRef);
      if (saved) {
        setForm((prev) => ({ ...prev, referralCode: saved }));
      }
    }
  }, [modeParam, urlRef]);

  useEffect(() => {
    if (!authLoading && user) navigate(returnTo, { replace: true });
  }, [authLoading, user, navigate, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUp) {
      const cleanRef = normalizeReferralCode(form.referralCode);
      const metadata: Record<string, string> = { full_name: form.fullName.trim() };
      if (cleanRef) {
        metadata.referral_code = cleanRef;
      }

      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: metadata,
          emailRedirectTo: `${window.location.origin}${returnTo}`,
        },
      });
      if (error) {
        toast.error(error.message);
      } else {
        clearStoredReferralCode();
        if (data?.session) {
          toast.success("Welcome to Roma! Your first delivery is FREE.");
        } else {
          toast.success("Check your email to confirm your account and claim your free first delivery!");
        }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Welcome back!");
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto flex items-center justify-center px-4 py-12 md:py-16">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Gift aria-hidden="true" className="h-3.5 w-3.5" />
              {isSignUp ? "First delivery FREE on sign-up" : "Sign up & get your 1st delivery FREE"}
            </div>
            <CardTitle className="font-display text-2xl">
              {isSignUp ? "Create Account" : "Sign In"}
            </CardTitle>
            <CardDescription>
              {isSignUp
                ? "Join Roma to get your first delivery free and earn free deliveries when you refer friends"
                : "Welcome back to Roma"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="e.g. Thabo Mokoena"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="referralCode" className="flex items-center gap-1.5">
                    <Users aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                    Referral Code <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="referralCode"
                    value={form.referralCode}
                    onChange={(e) => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. ROMA-7K3P9X"
                  />
                  {normalizeReferralCode(form.referralCode) ? (
                    <p className="text-xs text-primary">
                      Referral code {normalizeReferralCode(form.referralCode)} ready — your friend earns a free delivery once you send your first order!
                    </p>
                  ) : null}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? "Please wait..."
                  : isSignUp
                  ? "Create Account & Claim Free Delivery"
                  : "Sign In"}
              </Button>
            </form>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="font-medium text-primary hover:underline"
              >
                {isSignUp ? "Sign in" : "Sign up for free 1st delivery"}
              </button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AuthPage;

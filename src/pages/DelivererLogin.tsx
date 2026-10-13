import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { backendEnabled, login as backendLogin, getMe, clearToken } from "@/lib/backend";

const DelivererLogin = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (backendEnabled) {
        const res = await backendLogin(form.email, form.password);
        if (res.user.role !== 'deliverer' && res.user.role !== 'admin') {
          clearToken();
          toast.error("You do not have deliverer access. Contact the admin.");
          setLoading(false);
          return;
        }
        toast.success("Welcome, driver!");
        navigate("/deliverer");
      } else {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });

        if (authError) {
          toast.error(authError.message);
          setLoading(false);
          return;
        }

        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", authData.user.id)
          .eq("role", "deliverer")
          .maybeSingle();

        if (!roleData) {
          await supabase.auth.signOut();
          toast.error("You do not have deliverer access. Contact the admin.");
          setLoading(false);
          return;
        }

        toast.success("Welcome, driver!");
        navigate("/deliverer");
      }
    } catch (err: any) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Truck className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="font-display text-2xl">Deliverer Login {backendEnabled && <span className="text-xs font-normal text-green-600">(backend)</span>}</CardTitle>
          <CardDescription>Sign in to view and manage your deliveries</CardDescription>
          {backendEnabled && (
            <p className="text-xs text-muted-foreground mt-2">
              Test: deliverer@roma.co.za / deliverer123
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default DelivererLogin;

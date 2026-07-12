import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Truck } from "lucide-react";
import { toast } from "sonner";

interface DelivererProfile {
  user_id: string;
  full_name: string | null;
}

const DelivererManager = () => {
  const { adminSecret } = useAdminAuth();
  const [deliverers, setDeliverers] = useState<DelivererProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchDeliverers = async () => {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "deliverer");

    if (!roles || roles.length === 0) {
      setDeliverers([]);
      setLoading(false);
      return;
    }

    const userIds = roles.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    setDeliverers(
      roles.map((r) => ({
        user_id: r.user_id,
        full_name: profiles?.find((p) => p.id === r.user_id)?.full_name || null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchDeliverers();
  }, []);

  const handleAddDeliverer = async () => {
    if (!email || !password) {
      toast.error("Email and password are required");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (!adminSecret) {
      toast.error("Missing admin key — please sign in again");
      return;
    }

    setAdding(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { email, password, full_name: fullName, role: "deliverer" },
      headers: { "x-admin-secret": adminSecret },
    });

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Failed to create account");
      setAdding(false);
      return;
    }

    toast.success("Deliverer account created!");
    setEmail("");
    setPassword("");
    setFullName("");
    setAdding(false);
    fetchDeliverers();
  };

  const handleRemoveRole = async (userId: string) => {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "deliverer" as any);

    if (error) {
      toast.error("Failed to remove deliverer role");
      return;
    }
    toast.success("Deliverer role removed");
    fetchDeliverers();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold text-foreground">Add New Deliverer</h3>
        <p className="text-sm text-muted-foreground">
          Creates a confirmed account. Deliverer can immediately log in at /deliverer/login.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. John Doe" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="driver@example.com" />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
        </div>
        <Button onClick={handleAddDeliverer} disabled={adding}>
          <Plus className="mr-1 h-4 w-4" />
          {adding ? "Creating..." : "Create Deliverer Account"}
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading deliverers...</p>
      ) : deliverers.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Truck className="mx-auto h-10 w-10 text-muted-foreground/40 mb-2" />
          <p className="text-muted-foreground">No deliverers yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Active Deliverers ({deliverers.length})
          </h3>
          {deliverers.map((d) => (
            <div key={d.user_id} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <Truck className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{d.full_name || "Unnamed"}</p>
                  <p className="text-xs text-muted-foreground font-mono">{d.user_id.slice(0, 8)}…</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  Deliverer
                </Badge>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleRemoveRole(d.user_id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DelivererManager;

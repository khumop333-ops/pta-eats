import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  restaurantId: number;
  restaurantName: string;
  currentOwnerId?: string | null;
  onAssigned: () => void;
}

const RestaurantOwnerAssign = ({ restaurantId, restaurantName, currentOwnerId, onAssigned }: Props) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!email || password.length < 6) {
      toast.error("Email and 6+ char password required");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        email,
        password,
        full_name: fullName || restaurantName,
        role: "restaurant_owner",
        restaurant_id: restaurantId,
      },
    });

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Failed to create owner");
      setLoading(false);
      return;
    }

    toast.success(`Owner assigned to ${restaurantName}`);
    setEmail("");
    setPassword("");
    setFullName("");
    setLoading(false);
    onAssigned();
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">
          {currentOwnerId ? "Reassign Owner" : "Assign Restaurant Owner"}
        </p>
      </div>
      {currentOwnerId && (
        <p className="text-xs text-muted-foreground">
          Current owner ID: <span className="font-mono">{currentOwnerId.slice(0, 8)}…</span>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label className="text-xs">Owner Name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Owner name" />
        </div>
        <div>
          <Label className="text-xs">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" />
        </div>
        <div>
          <Label className="text-xs">Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 chars" />
        </div>
      </div>
      <Button size="sm" onClick={handleCreate} disabled={loading}>
        {loading ? "Creating..." : "Create Owner Account"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Owner logs in at <span className="font-mono">/owner/login</span> and only sees this restaurant.
      </p>
    </div>
  );
};

export default RestaurantOwnerAssign;

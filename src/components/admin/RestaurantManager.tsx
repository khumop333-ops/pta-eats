import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Pencil, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import MenuItemManager from "./MenuItemManager";

interface Restaurant {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image_url: string;
  delivery_time: string;
}

const emptyForm = { name: "", cuisine: "", rating: "4.0", image_url: "", delivery_time: "30-40 min" };

const RestaurantManager = () => {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const { data } = await supabase.from("restaurants").select("*").order("id");
    setRestaurants((data as Restaurant[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.cuisine) {
      toast.error("Name and cuisine are required");
      return;
    }

    const payload = {
      name: form.name,
      cuisine: form.cuisine,
      rating: parseFloat(form.rating) || 4.0,
      image_url: form.image_url || "/placeholder.svg",
      delivery_time: form.delivery_time || "30-40 min",
    };

    if (editingId) {
      const { error } = await supabase.from("restaurants").update(payload).eq("id", editingId);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Restaurant updated");
    } else {
      const { error } = await supabase.from("restaurants").insert(payload);
      if (error) { toast.error("Failed to add"); return; }
      toast.success("Restaurant added");
    }

    setForm(emptyForm);
    setEditingId(null);
    fetchAll();
  };

  const handleEdit = (r: Restaurant) => {
    setEditingId(r.id);
    setForm({ name: r.name, cuisine: r.cuisine, rating: String(r.rating), image_url: r.image_url, delivery_time: r.delivery_time });
  };

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("restaurants").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Restaurant deleted");
    fetchAll();
  };

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold text-foreground">
          {editingId ? "Edit Restaurant" : "Add Restaurant"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Restaurant name" />
          </div>
          <div>
            <Label>Cuisine</Label>
            <Input value={form.cuisine} onChange={(e) => setForm({ ...form, cuisine: e.target.value })} placeholder="e.g. Traditional South African" />
          </div>
          <div>
            <Label>Rating</Label>
            <Input value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} type="number" step="0.1" min="0" max="5" />
          </div>
          <div>
            <Label>Delivery Time</Label>
            <Input value={form.delivery_time} onChange={(e) => setForm({ ...form, delivery_time: e.target.value })} placeholder="e.g. 25-35 min" />
          </div>
          <div className="sm:col-span-2">
            <Label>Image URL</Label>
            <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave}>
            <Plus className="mr-1 h-4 w-4" /> {editingId ? "Update" : "Add"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : restaurants.length === 0 ? (
        <p className="text-muted-foreground">No restaurants yet.</p>
      ) : (
        <div className="space-y-3">
          {restaurants.map((r) => (
            <div key={r.id} className="rounded-lg border bg-card">
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold text-foreground">{r.name}</p>
                  <p className="text-sm text-muted-foreground">{r.cuisine} · ⭐ {r.rating} · {r.delivery_time}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                    {expandedId === r.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Menu
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {expandedId === r.id && (
                <div className="border-t p-4">
                  <MenuItemManager restaurantId={r.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RestaurantManager;

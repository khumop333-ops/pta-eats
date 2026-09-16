import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

interface MenuItemRow {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
}

const emptyForm = { name: "", description: "", price: "", category: "Mains" };

const MenuItemManager = ({ restaurantId }: { restaurantId: number }) => {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("category");
    setItems((data as MenuItemRow[]) || []);
  }, [restaurantId]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  const handleSave = async () => {
    const price = Number(form.price);
    if (!form.name.trim() || !Number.isFinite(price) || price <= 0) {
      toast.error("Enter a name and a valid price greater than zero");
      return;
    }

    const payload = {
      restaurant_id: restaurantId,
      name: form.name.trim(),
      description: form.description.trim(),
      price,
      category: form.category.trim() || "Mains",
    };

    if (editingId) {
      const { error } = await supabase.from("menu_items").update(payload).eq("id", editingId);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Item updated");
    } else {
      const { error } = await supabase.from("menu_items").insert(payload);
      if (error) { toast.error("Failed to add"); return; }
      toast.success("Item added");
    }

    setForm(emptyForm);
    setEditingId(null);
    void fetchItems();
  };

  const handleEdit = (item: MenuItemRow) => {
    setEditingId(item.id);
    setForm({ name: item.name, description: item.description, price: String(item.price), category: item.category });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this menu item?")) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Item deleted");
    void fetchItems();
  };

  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <div className="space-y-4">
      {/* Add/Edit form */}
      <div className="rounded border bg-muted/30 p-3 space-y-2">
        <p className="text-sm font-semibold text-foreground">{editingId ? "Edit Item" : "Add Item"}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item name" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Starters" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Price (R)</Label>
            <Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} type="number" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description" className="h-8 text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave}>
            <Plus className="mr-1 h-3 w-3" /> {editingId ? "Update" : "Add"}
          </Button>
          {editingId && (
            <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Items list */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No menu items yet.</p>
      ) : (
        categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
            <div className="space-y-1">
              {items.filter((i) => i.category === cat).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded border bg-card px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">R {Number(item.price).toFixed(2)}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${item.name}`} className="h-7 w-7" onClick={() => handleEdit(item)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${item.name}`} className="h-7 w-7 text-destructive" onClick={() => { void handleDelete(item.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default MenuItemManager;

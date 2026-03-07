import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import type { MenuItem } from "@/data/restaurants";

interface MenuItemCardProps {
  item: MenuItem;
  restaurantId: number;
}

const MenuItemCard = ({ item, restaurantId }: MenuItemCardProps) => {
  const { addItem } = useCart();

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4 transition-shadow hover:shadow-md">
      <div className="flex-1">
        <h4 className="font-body text-base font-semibold text-foreground">{item.name}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        <p className="mt-2 font-body text-base font-bold text-primary">R {item.price.toFixed(2)}</p>
      </div>
      <Button
        size="sm"
        onClick={() => addItem({ id: item.id, name: item.name, price: item.price, restaurantId })}
        className="shrink-0"
      >
        <Plus className="mr-1 h-4 w-4" /> Add
      </Button>
    </div>
  );
};

export default MenuItemCard;

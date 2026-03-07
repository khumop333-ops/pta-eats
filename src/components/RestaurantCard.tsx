import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface RestaurantCardProps {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image: string;
  deliveryTime: string;
}

const RestaurantCard = ({ id, name, cuisine, rating, image, deliveryTime }: RestaurantCardProps) => {
  return (
    <Link to={`/restaurant/${id}`}>
      <Card className="group overflow-hidden border-none shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
        <div className="aspect-[4/3] overflow-hidden">
          <img
            src={image}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-display text-lg font-semibold text-foreground">{name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{cuisine}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1">
              <Star className="h-3.5 w-3.5 fill-accent text-accent" />
              <span className="text-xs font-semibold text-secondary-foreground">{rating}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{deliveryTime}</p>
        </CardContent>
      </Card>
    </Link>
  );
};

export default RestaurantCard;

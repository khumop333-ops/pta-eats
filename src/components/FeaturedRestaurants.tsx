import { useEffect, useState } from "react";
import RestaurantCard from "./RestaurantCard";
import { fetchRestaurants, type Restaurant } from "@/data/restaurants";

const FeaturedRestaurants = () => {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRestaurants().then((data) => {
      setRestaurants(data);
      setLoading(false);
    });
  }, []);

  return (
    <section className="container mx-auto px-4 py-16">
      <div className="mb-8">
        <h2 className="font-display text-3xl font-bold text-foreground">
          Featured Restaurants
        </h2>
        <p className="mt-2 text-muted-foreground">
          Popular picks from Pretoria Central
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading restaurants...</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} {...r} />
          ))}
        </div>
      )}
    </section>
  );
};

export default FeaturedRestaurants;

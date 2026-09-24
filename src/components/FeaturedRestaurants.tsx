import { useEffect, useMemo, useState } from "react";
import RestaurantCard from "./RestaurantCard";
import { fetchRestaurants, type Restaurant } from "@/data/restaurants";

const FeaturedRestaurants = ({ searchQuery }: { searchQuery: string }) => {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchRestaurants()
      .then((data) => {
        if (!active) return;
        setRestaurants(data);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredRestaurants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return restaurants;
    return restaurants.filter((restaurant) =>
      [
        restaurant.name,
        restaurant.cuisine,
        ...restaurant.menu.flatMap((item) => [item.name, item.description, item.category]),
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [restaurants, searchQuery]);

  return (
    <section className="container mx-auto px-4 py-16" aria-live="polite">
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
      ) : failed ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">We couldn’t load restaurants right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">Please refresh and try again.</p>
        </div>
      ) : filteredRestaurants.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            {searchQuery ? "No restaurants or dishes match your search." : "No restaurants are available yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRestaurants.map((restaurant) => (
            <RestaurantCard key={restaurant.id} {...restaurant} />
          ))}
        </div>
      )}
    </section>
  );
};

export default FeaturedRestaurants;

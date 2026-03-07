import RestaurantCard from "./RestaurantCard";
import { restaurants } from "@/data/restaurants";

const FeaturedRestaurants = () => {
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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {restaurants.map((r) => (
          <RestaurantCard key={r.id} {...r} />
        ))}
      </div>
    </section>
  );
};

export default FeaturedRestaurants;

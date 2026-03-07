import RestaurantCard from "./RestaurantCard";
import restaurant1 from "@/assets/restaurant-1.jpg";
import restaurant2 from "@/assets/restaurant-2.jpg";
import restaurant3 from "@/assets/restaurant-3.jpg";

const restaurants = [
  {
    id: 1,
    name: "Tshwane Kitchen",
    cuisine: "Traditional South African",
    rating: 4.5,
    image: restaurant1,
    deliveryTime: "25–35 min",
  },
  {
    id: 2,
    name: "Church Street Eats",
    cuisine: "Street Food & Grills",
    rating: 4.3,
    image: restaurant2,
    deliveryTime: "20–30 min",
  },
  {
    id: 3,
    name: "Sunnyside Spices",
    cuisine: "Indian & African Fusion",
    rating: 4.7,
    image: restaurant3,
    deliveryTime: "30–40 min",
  },
];

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

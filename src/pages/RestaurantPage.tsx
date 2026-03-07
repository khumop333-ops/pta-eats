import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Star, Clock } from "lucide-react";
import Header from "@/components/Header";
import MenuItemCard from "@/components/MenuItemCard";
import CartSidebar from "@/components/CartSidebar";
import { getRestaurantById } from "@/data/restaurants";

const RestaurantPage = () => {
  const { id } = useParams();
  const restaurant = getRestaurantById(Number(id));

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto flex flex-col items-center justify-center py-24 text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">Restaurant not found</h1>
          <Link to="/" className="mt-4 text-primary underline">Back to home</Link>
        </div>
      </div>
    );
  }

  const categories = [...new Set(restaurant.menu.map((item) => item.category))];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="flex">
        <main className="flex-1">
          {/* Cover */}
          <div className="relative h-56 overflow-hidden md:h-72">
            <img src={restaurant.image} alt={restaurant.name} className="h-full w-full object-cover" />
            <div className="hero-overlay absolute inset-0" />
            <div className="absolute bottom-0 left-0 p-6">
              <Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-primary-foreground/80 hover:text-primary-foreground">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
              <h1 className="font-display text-3xl font-bold text-primary-foreground md:text-4xl">
                {restaurant.name}
              </h1>
              <div className="mt-2 flex items-center gap-4 text-sm text-primary-foreground/80">
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-accent text-accent" /> {restaurant.rating}
                </span>
                <span>{restaurant.cuisine}</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" /> {restaurant.deliveryTime}
                </span>
              </div>
            </div>
          </div>

          {/* Menu */}
          <div className="container mx-auto px-4 py-8">
            {categories.map((category) => (
              <section key={category} className="mb-10">
                <h2 className="font-display text-2xl font-semibold text-foreground mb-4">{category}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {restaurant.menu
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <MenuItemCard key={item.id} item={item} restaurantId={restaurant.id} />
                    ))}
                </div>
              </section>
            ))}
          </div>
        </main>

        {/* Cart sidebar — visible on desktop, floating button on mobile */}
        <CartSidebar />
      </div>
    </div>
  );
};

export default RestaurantPage;

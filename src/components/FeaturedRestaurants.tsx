import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import StorefrontRestaurantCard from "./storefront/StorefrontRestaurantCard";
import StorefrontSectionHeading from "./storefront/StorefrontSectionHeading";
import { StorefrontLoadingGrid, StorefrontNotice } from "./storefront/StorefrontState";
import { useHomepageRestaurants } from "@/hooks/use-homepage-restaurants";

const FeaturedRestaurants = () => {
  // Shared with the hero search via React Query — one request for the page.
  // In production fetchRestaurants throws on a failed fetch (demo data is
  // dev-only), which surfaces here as the error + retry state.
  const { data: restaurants = [], isPending: loading, isError: failed, refetch } =
    useHomepageRestaurants();
  const loadRestaurants = () => refetch();

  return (
    <section id="restaurants" className="container scroll-mt-20 mx-auto max-w-6xl px-4 py-14 md:py-20" aria-labelledby="featured-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <StorefrontSectionHeading
          eyebrow="Pretoria Central"
          title="Featured Restaurants"
          description="Popular picks from the neighbourhood, updated as restaurants join Roma."
          titleId="featured-heading"
        />
        <Link
          to="/r"
          className="inline-flex items-center gap-1 rounded-md text-sm font-semibold text-primary transition hover:gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Browse all restaurants
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>

      {loading ? (
        <StorefrontLoadingGrid count={3} className="mt-10" />
      ) : failed ? (
        <StorefrontNotice
          tone="error"
          className="mt-10"
          title="Restaurants couldn’t be loaded right now"
          message="Something went wrong while reaching Roma’s restaurant list. Please try again in a moment."
          actionLabel="Try again"
          onAction={() => void loadRestaurants()}
        />
      ) : restaurants.length === 0 ? (
        <StorefrontNotice
          className="mt-10"
          title="Roma is onboarding restaurants"
          message="New Pretoria Central kitchens are being added. Check back soon."
          actionLabel="Browse the directory"
          actionHref="/r"
        />
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map((restaurant) => (
            <StorefrontRestaurantCard
              key={restaurant.id}
              to={`/r/${restaurant.slug}`}
              name={restaurant.name}
              imageUrl={restaurant.image}
              cuisine={restaurant.cuisine}
              rating={restaurant.rating}
              deliveryTime={restaurant.deliveryTime}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default FeaturedRestaurants;

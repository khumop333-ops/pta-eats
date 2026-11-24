import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import StorefrontPageHeader from "@/components/storefront/StorefrontPageHeader";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";
import StorefrontRestaurantCard from "@/components/storefront/StorefrontRestaurantCard";
import StorefrontSectionHeading from "@/components/storefront/StorefrontSectionHeading";
import CampaignBanner from "@/components/storefront/CampaignBanner";
import {
  StorefrontLoadingGrid,
  StorefrontNotice,
} from "@/components/storefront/StorefrontState";

type RestaurantRow = Tables<"restaurants">;

const RestaurantDirectoryPage = () => {
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Restaurants — Roma";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;

    const loadRestaurants = async () => {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from("restaurants")
        .select("*")
        .eq("is_listed", true)
        .order("name");

      if (!isCurrent) return;

      if (queryError) {
        setError(queryError.message);
        setRestaurants([]);
      } else {
        setRestaurants(data ?? []);
      }
      setLoading(false);
    };

    void loadRestaurants();

    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  return (
    <div className="roma-surface flex min-h-screen flex-col">
      <StorefrontPageHeader backTo="/" backLabel="Home" />

      <main className="container mx-auto w-full max-w-6xl flex-1 px-4 py-12 md:py-16">
        <StorefrontSectionHeading
          eyebrow="Roma food directory"
          title="Restaurants"
          description="Find local favourites in Pretoria Central and browse what’s on the menu."
        />

        <div className="mt-8">
          <CampaignBanner variant="compact" />
        </div>

        {loading ? (
          <StorefrontLoadingGrid count={6} className="mt-10" />
        ) : error ? (
          <StorefrontNotice
            tone="error"
            className="mt-10"
            title="Restaurants couldn’t be loaded right now"
            message="Roma couldn’t reach the restaurant list. Please try again in a moment."
            actionLabel="Try again"
            onAction={() => setReloadKey((key) => key + 1)}
          />
        ) : restaurants.length === 0 ? (
          <StorefrontNotice
            className="mt-10"
            title="Roma is onboarding restaurants"
            message="New Pretoria Central kitchens are being added. Check back soon."
            actionLabel="Back to home"
            actionHref="/"
          />
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((restaurant) => (
              <StorefrontRestaurantCard
                key={restaurant.id}
                to={`/r/${restaurant.slug}`}
                name={restaurant.name}
                imageUrl={restaurant.cover_url || restaurant.image_url || restaurant.logo_url}
                blurb={restaurant.description}
                cuisine={restaurant.cuisine}
                rating={restaurant.rating}
                deliveryTime={restaurant.delivery_time}
              />
            ))}
          </div>
        )}
      </main>

      <StorefrontFooter />
    </div>
  );
};

export default RestaurantDirectoryPage;

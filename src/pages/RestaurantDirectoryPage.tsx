import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, UtensilsCrossed } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type RestaurantCardData = Pick<
  Tables<"restaurants">,
  "id" | "name" | "slug" | "description" | "cover_url" | "logo_url" | "image_url"
>;

const RestaurantDirectoryPage = () => {
  const [restaurants, setRestaurants] = useState<RestaurantCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        .select("id, name, slug, description, cover_url, logo_url, image_url")
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
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="font-display text-xl font-bold text-foreground">Roma</Link>
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">Home</Link>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Roma food directory</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-foreground md:text-5xl">Restaurants</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Find local favourites in Pretoria Central and browse what’s on the menu.
          </p>
        </div>

        {loading ? (
          <p className="mt-10 text-muted-foreground">Loading restaurants…</p>
        ) : error ? (
          <p role="alert" className="mt-10 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Restaurants couldn’t be loaded right now. Please try again soon.
          </p>
        ) : restaurants.length === 0 ? (
          <p className="mt-10 rounded-2xl border bg-card p-6 text-muted-foreground">
            Roma is onboarding restaurants in Pretoria Central. Check back soon.
          </p>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((restaurant) => {
              const imageUrl = restaurant.logo_url || restaurant.cover_url || restaurant.image_url || undefined;

              return (
                <Link
                  key={restaurant.id}
                  to={`/r/${restaurant.slug}`}
                  className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={restaurant.name}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/15 via-accent/20 to-muted">
                        <UtensilsCrossed aria-hidden="true" className="h-12 w-12 text-primary/40" />
                      </div>
                    )}
                    <span className="absolute bottom-3 right-3 rounded-full bg-background/90 p-2 text-foreground shadow-sm">
                      <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="p-5">
                    <h2 className="font-display text-xl font-semibold text-foreground">{restaurant.name}</h2>
                    <p className="mt-2 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                      {restaurant.description?.trim() || "Discover a local favourite in Pretoria Central."}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                      View menu <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default RestaurantDirectoryPage;

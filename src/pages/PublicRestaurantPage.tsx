import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, MessageCircle, UtensilsCrossed } from "lucide-react";
import { track } from "@vercel/analytics";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { buildWhatsAppLink, openWhatsApp, ROMA_WHATSAPP } from "@/lib/whatsapp";
import { isOpenNow, OPENING_HOURS_LABEL } from "@/lib/business";

type Restaurant = Tables<"restaurants">;
type MenuItem = Tables<"menu_items">;

const formatPrice = (price: number) => `R${Number(price).toFixed(2)}`;

const PublicRestaurantPage = () => {
  const { slug } = useParams();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    const loadRestaurant = async () => {
      setLoading(true);
      setRestaurant(null);
      setMenuItems([]);
      setNotFound(false);
      setPageError(null);
      setMenuError(null);

      if (!slug) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data: restaurantData, error: restaurantQueryError } = await supabase
        .from("restaurants")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();

      if (!isCurrent) return;
      if (restaurantQueryError) {
        setPageError(restaurantQueryError.message);
        setLoading(false);
        return;
      }
      if (!restaurantData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data: menuData, error: menuQueryError } = await supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantData.id)
        .order("sort_order");

      if (!isCurrent) return;
      setRestaurant(restaurantData);
      setMenuItems(menuData ?? []);
      setMenuError(menuQueryError?.message ?? null);
      setLoading(false);
    };

    void loadRestaurant();

    return () => {
      isCurrent = false;
    };
  }, [slug]);

  const restaurantName = restaurant?.name;
  useEffect(() => {
    if (!restaurantName) return;

    const previousTitle = document.title;
    document.title = `${restaurantName} — Roma`;

    return () => {
      document.title = previousTitle;
    };
  }, [restaurantName]);

  const menuCategories = useMemo(() => {
    const groupedItems = new Map<string, MenuItem[]>();

    for (const item of menuItems) {
      const category = item.category?.trim() || "Menu";
      const items = groupedItems.get(category) ?? [];
      items.push(item);
      groupedItems.set(category, items);
    }

    return Array.from(groupedItems.entries());
  }, [menuItems]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">Loading restaurant…</p>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">404</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-foreground">Restaurant not found</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          That restaurant page may have moved, or the link may be incorrect.
        </p>
        <Link to="/r" className="mt-6 inline-flex items-center gap-2 text-primary underline underline-offset-4">
          <ArrowLeft className="h-4 w-4" /> Browse restaurants
        </Link>
      </main>
    );
  }

  if (pageError || !restaurant) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">We couldn’t load this restaurant</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          {pageError || "Please try again in a moment."}
        </p>
        <Link to="/r" className="mt-6 text-primary underline underline-offset-4">Browse restaurants</Link>
      </main>
    );
  }

  const coverUrl = restaurant.cover_url || restaurant.image_url || undefined;
  const description = restaurant.description?.trim() || restaurant.cuisine?.trim();
  const address = [
    restaurant.address_line,
    restaurant.suburb,
    restaurant.city,
    restaurant.province,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(", ");

  const handleWhatsAppClick = () => {
    track("whatsapp_click", {
      restaurant_slug: slug ?? restaurant.slug,
      source: "restaurant_page",
    });

    const link = buildWhatsAppLink({
      to: ROMA_WHATSAPP,
      restaurantName: restaurant.name,
      restaurantSlug: restaurant.slug,
    });
    openWhatsApp(link);
  };

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <header className="border-b bg-card">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/r" className="font-display text-xl font-bold text-foreground">Roma</Link>
          <Link to="/r" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Browse restaurants
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6 md:py-10">
        <Link to="/r" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All restaurants
        </Link>

        <section className="relative isolate flex min-h-64 items-end overflow-hidden rounded-3xl bg-muted md:min-h-80">
          {coverUrl ? (
            <img src={coverUrl} alt={restaurant.name} className="absolute inset-0 -z-20 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 -z-20 flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/30 to-muted">
              <UtensilsCrossed aria-hidden="true" className="h-16 w-16 text-primary/40" />
            </div>
          )}
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          <div className="w-full p-6 text-white md:p-10">
            {restaurant.logo_url && (
              <img src={restaurant.logo_url} alt={`${restaurant.name} logo`} className="mb-4 h-14 w-14 rounded-xl bg-white object-contain p-1" />
            )}
            <h1 className="font-display text-3xl font-bold md:text-5xl">{restaurant.name}</h1>
            {description && <p className="mt-3 max-w-2xl text-base text-white/90 md:text-lg">{description}</p>}
            {address && (
              <p className="mt-3 flex items-center gap-2 text-sm text-white/85">
                <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" /> {address}
              </p>
            )}
          </div>
        </section>

        <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-start">
          <section className="min-w-0 flex-1" aria-labelledby="menu-heading">
            <div className="mb-6">
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-primary">Made for your table</p>
              <h2 id="menu-heading" className="mt-2 font-display text-2xl font-bold text-foreground md:text-3xl">Menu</h2>
            </div>

            {menuError && (
              <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                The menu couldn’t be loaded right now.
              </p>
            )}

            {menuItems.length === 0 ? (
              <div className="rounded-2xl border bg-card p-6 text-muted-foreground">
                The menu is being updated. Check back soon.
              </div>
            ) : (
              <div className="space-y-8">
                {menuCategories.map(([category, items]) => (
                  <section key={category} aria-label={category}>
                    <h3 className="mb-3 font-display text-xl font-semibold text-foreground">{category}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {items.map((item) => (
                        <article key={item.id} className="flex gap-4 rounded-2xl border bg-card p-4 shadow-sm">
                          {item.image_url && (
                            <img src={item.image_url} alt={item.name} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <h4 className="font-semibold text-foreground">{item.name}</h4>
                              <span className="shrink-0 font-semibold text-primary">{formatPrice(item.price)}</span>
                            </div>
                            {item.description && (
                              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>

          <aside className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur md:sticky md:top-6 md:bottom-auto md:inset-x-auto md:w-80 md:shrink-0 md:rounded-2xl md:border md:p-5">
            <div className="container mx-auto flex max-w-6xl items-center justify-between gap-4 md:block">
              <div className="min-w-0 md:mb-4">
                <p className="font-semibold text-foreground">Ready to order?</p>
                <p className="hidden text-sm text-muted-foreground md:block">
                  Message Roma on WhatsApp to place your order with {restaurant.name}.
                </p>
              </div>
              <p className="mb-1 hidden text-xs text-muted-foreground md:block">Open {OPENING_HOURS_LABEL}</p>
              <Button onClick={handleWhatsAppClick} disabled={!isOpenNow()} className="shrink-0 gap-2 md:w-full">
                <MessageCircle aria-hidden="true" className="h-4 w-4" />
                {isOpenNow() ? "Order on WhatsApp" : "Closed"}
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default PublicRestaurantPage;

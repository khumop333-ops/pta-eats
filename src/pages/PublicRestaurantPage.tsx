import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Clock, MapPin, MessageCircle, Plus, ShoppingCart } from "lucide-react";
import { track } from "@vercel/analytics";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { buildWhatsAppLink, openWhatsApp, ROMA_WHATSAPP } from "@/lib/whatsapp";
import { isOpenNow, OPENING_HOURS_LABEL } from "@/lib/business";
import { useCart } from "@/context/CartContext";
import StorefrontPageHeader from "@/components/storefront/StorefrontPageHeader";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";
import StorefrontImage from "@/components/storefront/StorefrontImage";
import StorefrontSectionHeading from "@/components/storefront/StorefrontSectionHeading";
// Loaded on first open: the drawer brings Radix Dialog (~30 kB gz) and the
// homepage is the public storefront, so it must not ride in the eager bundle.
const CartSheet = lazy(() => import("@/components/storefront/CartSheet"));
import {
  StorefrontLoadingPanel,
  StorefrontNotice,
} from "@/components/storefront/StorefrontState";

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
  const [reloadKey, setReloadKey] = useState(0);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartMounted, setCartMounted] = useState(false);

  const { items, addItem, clearCart, itemCount, subtotal } = useCart();

  const loadRestaurant = useCallback(async (isCurrent: () => boolean = () => true) => {
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

    if (!isCurrent()) return;
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

    if (!isCurrent()) return;
    setRestaurant(restaurantData);
    setMenuItems(menuData ?? []);
    setMenuError(menuQueryError?.message ?? null);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    let isCurrent = true;

    void loadRestaurant(() => isCurrent);

    return () => {
      isCurrent = false;
    };
  }, [loadRestaurant, reloadKey]);

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

  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.id, item.quantity);
    return map;
  }, [items]);

  const retry = () => setReloadKey((key) => key + 1);

  const shell = (children: ReactNode) => (
    // pb-32 keeps the fixed mobile order bar from covering the footer.
    <div className="roma-surface flex min-h-screen flex-col pb-32 md:pb-0">
      <StorefrontPageHeader backTo="/r" backLabel="Browse restaurants" />
      <main className="container mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-10">
        {children}
      </main>
      <StorefrontFooter />
    </div>
  );

  if (loading) {
    return shell(<StorefrontLoadingPanel className="mt-2" />);
  }

  if (notFound) {
    return shell(
      <>
        <p className="roma-eyebrow">404</p>
        <StorefrontNotice
          className="mt-3"
          title="Restaurant not found"
          message="That restaurant page may have moved, or the link may be incorrect."
          actionLabel="See all restaurants"
          actionHref="/r"
        />
      </>,
    );
  }

  if (pageError || !restaurant) {
    return shell(
      <StorefrontNotice
        tone="error"
        title="We couldn’t load this restaurant"
        message={pageError || "Please try again in a moment."}
        actionLabel="Try again"
        onAction={retry}
      />,
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
  const closed = !isOpenNow();

  const addToCart = (item: MenuItem) => {
    const result = addItem({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
    });

    if (result === "restaurant-mismatch") {
      toast("Your cart has food from another restaurant", {
        description: "Roma delivers one restaurant per order. Start a new cart to add this dish?",
        action: {
          label: "Start new cart",
          onClick: () => {
            clearCart();
            addItem({
              id: item.id,
              name: item.name,
              price: Number(item.price),
              restaurantId: restaurant.id,
              restaurantName: restaurant.name,
            });
          },
        },
      });
      return;
    }

    track("add_to_cart", {
      restaurant_slug: restaurant.slug,
      item_id: item.id,
    });
  };

  const handleWhatsAppClick = () => {
    track("whatsapp_click", {
      restaurant_slug: slug ?? restaurant.slug,
      source: "restaurant_page",
      item_count: itemCount,
      cart_value: Number(subtotal.toFixed(2)),
    });

    const link = buildWhatsAppLink({
      to: ROMA_WHATSAPP,
      restaurantName: restaurant.name,
      restaurantSlug: restaurant.slug,
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        priceCents: Math.round(item.price * 100),
      })),
    });
    openWhatsApp(link);
  };

  return shell(
    <>
      <Link
        to="/r"
        className="mb-4 inline-flex items-center gap-2 rounded-md text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> All restaurants
      </Link>

      <section className="relative isolate flex min-h-64 items-end overflow-hidden rounded-3xl bg-muted md:min-h-80">
        <StorefrontImage
          src={coverUrl}
          alt={restaurant.name}
          eager
          className="absolute inset-0 -z-20 h-full w-full"
          fallbackIconClassName="h-16 w-16"
        />
        <div className="roma-veil absolute inset-0 -z-10" />
        <div className="w-full p-6 text-white md:p-10">
          {restaurant.logo_url ? (
            <img
              src={restaurant.logo_url}
              alt={`${restaurant.name} logo`}
              loading="lazy"
              decoding="async"
              className="mb-4 h-14 w-14 rounded-xl bg-white object-contain p-1"
            />
          ) : null}
          <h1 className="font-display text-3xl font-bold md:text-5xl">{restaurant.name}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-base text-white/90 md:text-lg">{description}</p>
          ) : null}
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
            {address ? (
              <span className="flex items-center gap-2">
                <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" /> {address}
              </span>
            ) : null}
            <span className="flex items-center gap-2">
              <Clock aria-hidden="true" className="h-4 w-4 shrink-0" /> Open {OPENING_HOURS_LABEL}
            </span>
          </p>
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-start">
        <section className="min-w-0 flex-1" aria-labelledby="menu-heading">
          <StorefrontSectionHeading
            eyebrow="Made for your table"
            title="Menu"
            titleId="menu-heading"
          />

          {menuError ? (
            <StorefrontNotice
              tone="error"
              className="mt-6"
              title="The menu couldn’t be loaded right now"
              message="The restaurant is still here — only its menu is unavailable. Please try again in a moment."
              actionLabel="Try again"
              onAction={retry}
            />
          ) : menuItems.length === 0 ? (
            <StorefrontNotice
              className="mt-6"
              title="The menu is being updated"
              message="Roma is capturing this kitchen’s menu with the owner. Check back soon."
            />
          ) : (
            <div className="mt-8 space-y-8">
              {menuCategories.map(([category, categoryItems]) => (
                <section key={category} aria-label={category}>
                  <h3 className="mb-3 font-display text-xl font-semibold text-foreground">{category}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {categoryItems.map((item) => {
                      const inCart = quantities.get(item.id) ?? 0;

                      return (
                        <article key={item.id} className="roma-card flex gap-4 p-4 hover:shadow-md">
                          <StorefrontImage
                            src={item.image_url}
                            alt={item.name}
                            className="h-20 w-20 shrink-0 rounded-xl"
                            fallbackIconClassName="h-6 w-6"
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start justify-between gap-3">
                              <h4 className="font-semibold text-foreground">{item.name}</h4>
                              <span className="shrink-0 font-semibold text-primary">
                                {formatPrice(item.price)}
                              </span>
                            </div>
                            {item.description ? (
                              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                            <div className="mt-auto flex items-center gap-2 pt-3">
                              <Button
                                size="sm"
                                onClick={() => addToCart(item)}
                                disabled={closed}
                                aria-label={`Add ${item.name} to cart`}
                                className="gap-1"
                              >
                                <Plus aria-hidden="true" className="h-4 w-4" /> Add
                              </Button>
                              {inCart > 0 ? (
                                <span className="text-xs font-medium text-muted-foreground">
                                  {inCart} in cart
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        <aside className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur md:sticky md:top-6 md:bottom-auto md:inset-x-auto md:w-80 md:shrink-0 md:rounded-2xl md:border md:p-5">
          <div className="container mx-auto flex max-w-6xl items-center justify-between gap-3 md:block md:mx-0 md:max-w-none">
            <div className="min-w-0 md:mb-4">
              <p className="font-semibold text-foreground">
                {itemCount > 0 ? `Your cart · ${formatPrice(subtotal)}` : "Ready to order?"}
              </p>
              <p className="hidden text-sm text-muted-foreground md:block">
                {itemCount > 0
                  ? `${itemCount} ${itemCount === 1 ? "item" : "items"} from ${restaurant.name}.`
                  : "Add dishes, then order on WhatsApp or check out by card or cash."}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 md:w-full md:flex-col md:items-stretch">
              {itemCount > 0 ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setCartMounted(true);
                    setCartOpen(true);
                  }}
                  className="gap-2 md:w-full"
                  aria-label={`View cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}, ${formatPrice(subtotal)}`}
                >
                  <ShoppingCart aria-hidden="true" className="h-4 w-4" />
                  <span className="md:hidden">{itemCount}</span>
                  <span className="hidden md:inline">View cart</span>
                </Button>
              ) : null}
              <Button
                onClick={handleWhatsAppClick}
                disabled={closed}
                className="shrink-0 gap-2 md:w-full"
              >
                <MessageCircle aria-hidden="true" className="h-4 w-4" />
                {closed ? "Closed" : "Order on WhatsApp"}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {cartMounted ? (
        <Suspense fallback={null}>
          <CartSheet
            open={cartOpen}
            onOpenChange={setCartOpen}
            restaurantName={restaurant.name}
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default PublicRestaurantPage;

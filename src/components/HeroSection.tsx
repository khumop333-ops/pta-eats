import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Search, Store, UtensilsCrossed, X } from "lucide-react";
import { track } from "@vercel/analytics";
import { Input } from "@/components/ui/input";
import StorefrontImage from "./storefront/StorefrontImage";
import { OPENING_HOURS_LABEL } from "@/lib/business";
import { MIN_QUERY_LENGTH, searchCatalog } from "@/lib/search";
import { useHomepageRestaurants } from "@/hooks/use-homepage-restaurants";
import heroImage from "@/assets/hero-food.jpg";

const formatPrice = (price: number) => `R ${price.toFixed(2)}`;

// One canonical restaurant page since the merge: /r/:slug carries the cart,
// WhatsApp ordering and bank-transfer/cash checkout.
const restaurantHref = (slug: string) => `/r/${slug}`;

const resultLinkClass =
  "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const HeroSection = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { data: restaurants = [], isPending, isError } = useHomepageRestaurants();
  const resultsId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  // On phones the on-screen keyboard covers the lower ~40% of the viewport,
  // which is exactly where results render. Lift the search to just under the
  // sticky header when it gains focus so results stay visible while typing.
  const liftSearchIntoView = () => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  };

  const trimmed = query.trim();
  const isSearching = trimmed.length >= MIN_QUERY_LENGTH;
  const results = useMemo(() => searchCatalog(restaurants, trimmed), [restaurants, trimmed]);
  const firstHref =
    results.restaurants[0] !== undefined
      ? restaurantHref(results.restaurants[0].slug)
      : results.dishes[0] !== undefined
        ? restaurantHref(results.dishes[0].restaurant.slug)
        : null;

  const trackSelect = (kind: "restaurant" | "dish", via: "tap" | "enter") => {
    // Volume of this event decides whether server-side search is ever needed.
    track("hero_search_select", { kind, via, queryLength: trimmed.length, results: results.total });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!firstHref) return;
    trackSelect(results.restaurants.length > 0 ? "restaurant" : "dish", "enter");
    navigate(firstHref);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };

  const statusMessage = !isSearching
    ? ""
    : isPending
      ? "Loading restaurants…"
      : isError
        ? "Search is unavailable right now."
        : results.total === 0
          ? `No matches for “${trimmed}”.`
          : `${results.total} ${results.total === 1 ? "match" : "matches"} for “${trimmed}”.`;

  return (
    <section className="relative isolate flex min-h-[480px] items-center justify-center overflow-hidden px-4 py-16 md:min-h-[560px]">
      <StorefrontImage
        src={heroImage}
        alt="South African street food spread"
        eager
        className="absolute inset-0 -z-20 h-full w-full"
        fallbackIconClassName="h-16 w-16"
      />
      <div className="hero-overlay absolute inset-0 -z-10" />

      <div className="relative z-10 mx-auto w-full max-w-2xl text-center">
        <p className="roma-eyebrow text-primary-foreground/80">
          Pretoria Central · Open {OPENING_HOURS_LABEL}
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground md:text-5xl lg:text-6xl">
          Local Favourites, Delivered to Your Door.
        </h1>
        <p className="mt-4 text-base text-primary-foreground/85 md:text-lg">
          Browse the kitchens Roma works with in Pretoria Central, then order by WhatsApp or card —
          no app to install.
        </p>

        <form
          ref={formRef}
          role="search"
          onSubmit={handleSubmit}
          className="relative mx-auto mt-8 max-w-lg scroll-mt-20"
        >
          <label htmlFor={`${resultsId}-input`} className="sr-only">
            Search for restaurants or dishes
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-6 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={`${resultsId}-input`}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={liftSearchIntoView}
            placeholder="Search for restaurants or dishes…"
            aria-describedby={`${resultsId}-status`}
            aria-controls={isSearching ? resultsId : undefined}
            className={`h-12 rounded-full border-none bg-card pl-12 text-base ${query ? "pr-12" : "pr-4"} shadow-lg focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-0 flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          ) : null}

          {/* Announced to screen readers as results change; visible text below. */}
          <p id={`${resultsId}-status`} className="sr-only" aria-live="polite" aria-atomic="true">
            {statusMessage}
          </p>

          {isSearching ? (
            <div
              id={resultsId}
              className="mt-3 max-h-[min(60vh,26rem)] overflow-y-auto rounded-2xl bg-card p-2 text-left text-card-foreground shadow-xl"
            >
              {isPending ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">Loading restaurants…</p>
              ) : isError ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  Search is unavailable right now.{" "}
                  <Link to="/r" className="font-semibold text-primary underline-offset-2 hover:underline">
                    Browse all restaurants
                  </Link>
                </p>
              ) : results.total === 0 ? (
                <div className="px-3 py-3 text-sm">
                  <p className="font-medium text-foreground">No matches for “{trimmed}”.</p>
                  <p className="mt-1 text-muted-foreground">
                    Menus are still being added — try a restaurant name, or{" "}
                    <Link to="/r" className="font-semibold text-primary underline-offset-2 hover:underline">
                      browse all restaurants
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <>
                  {results.restaurants.length > 0 ? (
                    <section aria-label="Restaurants">
                      <h2 className="px-3 pb-1 pt-2 font-body text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Restaurants
                      </h2>
                      <ul>
                        {results.restaurants.map((restaurant) => (
                          <li key={restaurant.id}>
                            <Link
                              to={restaurantHref(restaurant.slug)}
                              onClick={() => trackSelect("restaurant", "tap")}
                              className={resultLinkClass}
                            >
                              <span className="roma-image-fallback flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary">
                                <Store aria-hidden="true" className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-foreground">{restaurant.name}</span>
                                {restaurant.cuisine?.trim() ? (
                                  <span className="block truncate text-xs text-muted-foreground">{restaurant.cuisine}</span>
                                ) : null}
                              </span>
                              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {results.dishes.length > 0 ? (
                    <section aria-label="Dishes">
                      <h2 className="px-3 pb-1 pt-2 font-body text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Dishes
                      </h2>
                      <ul>
                        {results.dishes.map(({ restaurant, item }) => (
                          <li key={item.id}>
                            <Link
                              to={restaurantHref(restaurant.slug)}
                              onClick={() => trackSelect("dish", "tap")}
                              className={resultLinkClass}
                            >
                              <span className="roma-image-fallback flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary">
                                <UtensilsCrossed aria-hidden="true" className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-foreground">{item.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  at {restaurant.name}
                                </span>
                              </span>
                              <span className="shrink-0 text-sm font-semibold text-foreground">
                                {formatPrice(item.price)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
};

export default HeroSection;

import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, Star } from "lucide-react";
import StorefrontImage from "./StorefrontImage";
import { cn } from "@/lib/utils";

type StorefrontRestaurantCardProps = {
  /** Homepage tiles point at the legacy cart flow, directory tiles at /r/:slug. */
  to: string;
  name: string;
  imageUrl?: string | null;
  blurb?: string | null;
  cuisine?: string | null;
  rating?: number | null;
  deliveryTime?: string | null;
  ctaLabel?: string;
  className?: string;
};

const fallbackBlurb = "Discover a local favourite in Pretoria Central.";

/**
 * One restaurant tile for the whole public storefront, so a card on the
 * homepage and a card in the directory are unmistakably the same thing even
 * though they come from different queries and lead to different flows.
 */
const StorefrontRestaurantCard = ({
  to,
  name,
  imageUrl,
  blurb,
  cuisine,
  rating,
  deliveryTime,
  ctaLabel = "View menu",
  className,
}: StorefrontRestaurantCardProps) => {
  const description = blurb?.trim() || fallbackBlurb;

  return (
    <Link
      to={to}
      aria-label={`${name} — ${ctaLabel.toLowerCase()}`}
      className={cn(
        "roma-card group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "hover:-translate-y-0.5 hover:shadow-lg",
        className,
      )}
    >
      <div className="relative aspect-[16/10]">
        <StorefrontImage
          src={imageUrl}
          alt={name}
          className="h-full w-full"
          imgClassName="transition duration-500 group-hover:scale-[1.03]"
        />
        <span className="absolute bottom-3 right-3 rounded-full bg-background/90 p-2 text-foreground shadow-sm transition group-hover:bg-primary group-hover:text-primary-foreground">
          <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
        </span>
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-foreground md:text-xl">
            {name}
          </h3>
          {rating !== null && rating !== undefined ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">
              <Star aria-hidden="true" className="h-3.5 w-3.5 fill-accent text-accent" />
              {rating}
            </span>
          ) : null}
        </div>

        <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {cuisine?.trim() ? `${cuisine.trim()} · ${description}` : description}
        </p>

        {deliveryTime ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" />
              {deliveryTime}
            </span>
          </p>
        ) : null}

        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
          {ctaLabel}
          <ArrowUpRight aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
};

export default StorefrontRestaurantCard;

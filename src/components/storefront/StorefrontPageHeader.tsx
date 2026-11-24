import { Link, useLocation } from "react-router-dom";
import { Gift } from "lucide-react";
import RomaBrandmark from "./RomaBrandmark";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

type StorefrontPageHeaderProps = {
  /** Secondary action on the right, e.g. "Home" or "Browse restaurants". */
  backTo?: string;
  backLabel?: string;
  className?: string;
};

/**
 * Shared header for the directory, public restaurant, checkout, and referral pages.
 * Keeps staff navigation out of shareable pages while surfacing the customer's
 * free-delivery credits or the welcome sign-up offer.
 */
const StorefrontPageHeader = ({
  backTo = "/",
  backLabel = "Home",
  className,
}: StorefrontPageHeaderProps) => {
  const { user, profile } = useAuth();
  const location = useLocation();
  const credits = Math.max(0, profile?.free_delivery_credits ?? 0);

  return (
    <header className={cn("sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md", className)}>
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
        <RomaBrandmark to="/" />

        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <Link
              to="/referrals"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Gift aria-hidden="true" className="h-3.5 w-3.5" />
              <span>
                {credits > 0
                  ? `${credits} Free ${credits === 1 ? "delivery" : "deliveries"}`
                  : "Referrals"}
              </span>
            </Link>
          ) : (
            <Link
              to="/auth?mode=signup"
              state={{ from: location.pathname }}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Gift aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Free 1st delivery</span>
            </Link>
          )}

          <Link
            to={backTo}
            className="rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {backLabel}
          </Link>
        </div>
      </div>
    </header>
  );
};

export default StorefrontPageHeader;

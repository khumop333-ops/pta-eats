import { Link } from "react-router-dom";
import { Clock, MapPin } from "lucide-react";
import { OPENING_HOURS_LABEL } from "@/lib/business";

/**
 * Footer shared by the homepage, the directory and the public restaurant page.
 * The opening-hours line is display-only and reads the existing rule from
 * `src/lib/business.ts`; it does not restate or override it.
 */
const StorefrontFooter = () => (
  <footer className="border-t bg-card">
    <div className="container mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-start md:justify-between">
      <div className="max-w-sm">
        <p className="font-display text-lg font-bold text-foreground">Roma</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Delivering local favourites in Pretoria Central.
        </p>
      </div>

      <nav aria-label="Roma" className="flex flex-col gap-2 text-sm">
        <Link to="/" className="w-fit text-muted-foreground transition hover:text-foreground">
          Home
        </Link>
        <Link to="/r" className="w-fit text-muted-foreground transition hover:text-foreground">
          Browse restaurants
        </Link>
      </nav>

      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-primary/70" />
          Pretoria Central, Gauteng
        </p>
        <p className="flex items-center gap-2">
          <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-primary/70" />
          Open {OPENING_HOURS_LABEL}
        </p>
      </div>
    </div>

    <div className="border-t">
      <div className="container mx-auto max-w-6xl px-4 py-4 text-center text-xs text-muted-foreground md:text-left">
        © 2026 Roma. All prices in South African Rand.
      </div>
    </div>
  </footer>
);

export default StorefrontFooter;

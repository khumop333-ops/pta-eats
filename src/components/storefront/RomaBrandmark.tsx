import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type RomaBrandmarkProps = {
  /** Where the mark links to. */
  to: string;
  onClick?: () => void;
  className?: string;
};

/**
 * The Roma mark as used on every public surface. Mirrors the customer header
 * (`@/components/Header`) so the shareable pages and the homepage read as one
 * product without importing the signed-in navigation into guest pages.
 */
const RomaBrandmark = ({ to, onClick, className }: RomaBrandmarkProps) => (
  <Link
    to={to}
    onClick={onClick}
    className={cn("flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
  >
    <img
      src="/roma-logo.jpg"
      alt="Roma"
      className="h-10 w-10 shrink-0 rounded-xl object-cover"
    />
    <span className="truncate font-display text-xl font-bold text-foreground">Roma</span>
  </Link>
);

export default RomaBrandmark;

import { Link } from "react-router-dom";
import RomaBrandmark from "./RomaBrandmark";
import { cn } from "@/lib/utils";

type StorefrontPageHeaderProps = {
  /** Secondary action on the right, e.g. "Home" or "Browse restaurants". */
  backTo?: string;
  backLabel?: string;
  className?: string;
};

/**
 * Guest header for the directory and public restaurant pages. Deliberately
 * mirrors the customer `Header` (height, blur, border, brandmark) without
 * pulling the signed-in/staff navigation into shareable pages.
 */
const StorefrontPageHeader = ({
  backTo = "/",
  backLabel = "Home",
  className,
}: StorefrontPageHeaderProps) => (
  <header className={cn("sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md", className)}>
    <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
      <RomaBrandmark to="/" />
      <Link
        to={backTo}
        className="rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {backLabel}
      </Link>
    </div>
  </header>
);

export default StorefrontPageHeader;

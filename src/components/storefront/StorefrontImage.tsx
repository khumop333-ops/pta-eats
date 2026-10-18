import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { isUsableImageSrc } from "./imageSrc";

type StorefrontImageProps = {
  /** May be null, undefined, blank or a dead URL — all fall back to the Roma mark. */
  src?: string | null;
  alt: string;
  /** Classes for the media frame (give it a height/aspect ratio). */
  className?: string;
  imgClassName?: string;
  fallbackIconClassName?: string;
  /** For above-the-fold art (hero/cover); everything else lazy-loads. */
  eager?: boolean;
};

/**
 * One image treatment for every public storefront surface: same rounding, same
 * lazy loading, and the same branded fallback when photography is missing,
 * blank or fails to load.
 */
const StorefrontImage = ({
  src,
  alt,
  className,
  imgClassName,
  fallbackIconClassName,
  eager = false,
}: StorefrontImageProps) => {
  const resolved = isUsableImageSrc(src) ? src!.trim() : undefined;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showFallback = !resolved || failedSrc === resolved;

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {showFallback ? (
        <div
          role="img"
          aria-label={`${alt} — no photo yet`}
          className="roma-image-fallback absolute inset-0 flex items-center justify-center"
        >
          <UtensilsCrossed
            aria-hidden="true"
            className={cn("h-10 w-10 shrink-0 text-primary/45", fallbackIconClassName)}
          />
        </div>
      ) : (
        <img
          src={resolved}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailedSrc(resolved)}
          className={cn("h-full w-full bg-muted object-cover", imgClassName)}
        />
      )}
    </div>
  );
};

export default StorefrontImage;

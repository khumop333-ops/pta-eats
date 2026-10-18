import { AlertTriangle, RefreshCw, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Card placeholders so a slow fetch never collapses the layout. */
export function StorefrontLoadingGrid({
  count = 6,
  className,
  label = "Loading restaurants…",
}: {
  count?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3", className)}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="roma-card">
          <Skeleton className="aspect-[16/10] w-full rounded-none" />
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Cover + list placeholders for a single-restaurant page. */
export function StorefrontLoadingPanel({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-8", className)} aria-busy="true" aria-live="polite">
      <Skeleton className="min-h-64 w-full rounded-3xl md:min-h-80" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      <span className="sr-only">Loading restaurant…</span>
    </div>
  );
}

type StorefrontNoticeProps = {
  title: string;
  message: string;
  tone?: "empty" | "error";
  icon?: LucideIcon;
  actionLabel?: string;
  /** Retry-style action (used by error states). */
  onAction?: () => void;
  /** Navigation-style action (used by empty states). */
  actionHref?: string;
  className?: string;
};

/**
 * The single loading/empty/error vocabulary for the public storefront: a calm
 * "nothing here yet" card and a visibly different "something went wrong" card.
 */
export function StorefrontNotice({
  title,
  message,
  tone = "empty",
  icon,
  actionLabel,
  onAction,
  actionHref,
  className,
}: StorefrontNoticeProps) {
  const isError = tone === "error";
  const Icon = icon ?? (isError ? AlertTriangle : UtensilsCrossed);

  return (
    <div
      role={isError ? "alert" : undefined}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-6 sm:flex-row sm:items-center",
        isError ? "border-destructive/30 bg-destructive/5" : "bg-card",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
          isError ? "bg-destructive/10 text-destructive" : "roma-image-fallback text-primary/60",
        )}
      >
        <Icon aria-hidden="true" className="h-6 w-6" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold text-foreground">{title}</p>
        <p
          className={cn(
            "mt-1 text-sm leading-relaxed",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      </div>

      {actionLabel && onAction ? (
        <Button
          onClick={onAction}
          variant={isError ? "default" : "outline"}
          size="sm"
          className="shrink-0 gap-2"
        >
          {isError ? <RefreshCw aria-hidden="true" className="h-4 w-4" /> : null}
          {actionLabel}
        </Button>
      ) : null}

      {!onAction && actionLabel && actionHref ? (
        <Button asChild variant={isError ? "default" : "outline"} size="sm" className="shrink-0 gap-2">
          <Link to={actionHref}>
            {isError ? <RefreshCw aria-hidden="true" className="h-4 w-4" /> : null}
            {actionLabel}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

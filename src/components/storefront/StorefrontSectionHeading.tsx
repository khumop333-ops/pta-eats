import { cn } from "@/lib/utils";

type StorefrontSectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  /** id for the heading, so a section can be labelled by it. */
  titleId?: string;
  align?: "left" | "center";
  className?: string;
};

/** The shared eyebrow / title / deck rhythm used by all three storefront pages. */
const StorefrontSectionHeading = ({
  eyebrow,
  title,
  description,
  titleId,
  align = "left",
  className,
}: StorefrontSectionHeadingProps) => (
  <div
    className={cn(
      "max-w-2xl",
      align === "center" && "mx-auto text-center",
      className,
    )}
  >
    {eyebrow ? <p className="roma-eyebrow">{eyebrow}</p> : null}
    <h2
      id={titleId}
      className={cn(
        "font-display text-3xl font-bold text-foreground md:text-4xl",
        eyebrow ? "mt-2" : "mt-0",
      )}
    >
      {title}
    </h2>
    {description ? (
      <p className="mt-3 text-base text-muted-foreground md:text-lg">{description}</p>
    ) : null}
  </div>
);

export default StorefrontSectionHeading;

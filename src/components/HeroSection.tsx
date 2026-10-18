import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import StorefrontImage from "./storefront/StorefrontImage";
import { OPENING_HOURS_LABEL } from "@/lib/business";
import heroImage from "@/assets/hero-food.jpg";

const HeroSection = () => {
  // NOTE: the search field is unchanged and still presentational — wiring it to
  // real results is a behaviour change, out of scope for this visual refresh.
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

      <div className="relative z-10 mx-auto max-w-2xl text-center">
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

        <div className="relative mx-auto mt-8 max-w-lg">
          <Search
            aria-hidden="true"
            className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search for restaurants or dishes..."
            aria-label="Search for restaurants or dishes"
            className="h-12 rounded-full border-none bg-card pl-12 text-base shadow-lg focus-visible:ring-primary"
          />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import heroImage from "@/assets/hero-food.jpg";

const HeroSection = () => {
  return (
    <section className="relative flex min-h-[480px] items-center justify-center overflow-hidden md:min-h-[540px]">
      <img
        src={heroImage}
        alt="South African street food spread"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="hero-overlay absolute inset-0" />

      <div className="relative z-10 mx-auto max-w-2xl px-4 text-center">
        <h1 className="font-display text-4xl font-bold leading-tight text-primary-foreground md:text-5xl lg:text-6xl">
          Local Favourites, Delivered to Your Door in Pretoria Central.
        </h1>
        <p className="mt-4 text-lg text-primary-foreground/80">
          Discover the best restaurants and cuisines right in your neighbourhood.
        </p>

        <div className="relative mx-auto mt-8 max-w-lg">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search for restaurants or dishes..."
            className="h-12 rounded-full border-none bg-card pl-12 text-base shadow-lg focus-visible:ring-primary"
          />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;

import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeaturedRestaurants from "@/components/FeaturedRestaurants";
import BackendStatus from "@/components/BackendStatus";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection />
        <FeaturedRestaurants />
      </main>
      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © 2026 Roma. Delivering local favourites in Pretoria Central.
          <div className="mt-2 text-xs opacity-70">
            Fresh backend available at <code className="rounded bg-muted px-1">/server</code> → <code>npm run dev:backend</code>
          </div>
        </div>
      </footer>
      <BackendStatus />
    </div>
  );
};

export default Index;

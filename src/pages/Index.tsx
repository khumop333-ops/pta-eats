import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeaturedRestaurants from "@/components/FeaturedRestaurants";
import { Link } from "react-router-dom";

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
          <div className="mt-3">
            <Link to="/r" className="text-primary underline-offset-4 hover:underline">Browse restaurants</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;

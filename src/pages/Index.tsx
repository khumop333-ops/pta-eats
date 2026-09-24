import { useState } from "react";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeaturedRestaurants from "@/components/FeaturedRestaurants";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        <FeaturedRestaurants searchQuery={searchQuery} />
      </main>
      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © 2026 Roma. Delivering local favourites in Pretoria Central.
        </div>
      </footer>
    </div>
  );
};

export default Index;

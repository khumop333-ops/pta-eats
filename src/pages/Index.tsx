import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeaturedRestaurants from "@/components/FeaturedRestaurants";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";

const Index = () => {
  return (
    <div className="roma-surface min-h-screen">
      <Header />
      <main>
        <HeroSection />
        <FeaturedRestaurants />
      </main>
      <StorefrontFooter />
    </div>
  );
};

export default Index;

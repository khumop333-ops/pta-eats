import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import CampaignBanner from "@/components/storefront/CampaignBanner";
import FeaturedRestaurants from "@/components/FeaturedRestaurants";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";

const Index = () => {
  return (
    <div className="roma-surface min-h-screen">
      <Header />
      <main>
        <HeroSection />
        <CampaignBanner />
        <FeaturedRestaurants />
      </main>
      <StorefrontFooter />
    </div>
  );
};

export default Index;

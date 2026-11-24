import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { Suspense, useEffect } from "react";
import RouteFallback from "@/components/RouteFallback";
import { lazyRoute } from "@/lib/lazyRoute";
import { saveReferralCode } from "@/lib/referrals";
// Eager: the public storefront — where WhatsApp-shared links and the homepage
// land — must not wait on an extra chunk round-trip on a slow connection.
import Index from "./pages/Index";
import PublicRestaurantPage from "./pages/PublicRestaurantPage";
import RestaurantDirectoryPage from "./pages/RestaurantDirectoryPage";
import NotFound from "./pages/NotFound";

// Lazy: ordering flow, auth, referrals, and staff dashboards. Customers no longer
// download admin/owner/driver code they will never use.
const LegacyRestaurantRedirect = lazyRoute(() => import("./pages/LegacyRestaurantRedirect"));
// The live, guest-friendly checkout: bank transfer / cash, sent via WhatsApp.
const WhatsAppCheckout = lazyRoute(() => import("./pages/WhatsAppCheckout"));
// Dormant: the old card/cash checkout is still routed for direct links, but
// nothing in the storefront points at it any more.
const Checkout = lazyRoute(() => import("./pages/Checkout"));
const OrderConfirmation = lazyRoute(() => import("./pages/OrderConfirmation"));
const AuthPage = lazyRoute(() => import("./pages/AuthPage"));
const ReferralsPage = lazyRoute(() => import("./pages/ReferralsPage"));
const MyOrders = lazyRoute(() => import("./pages/MyOrders"));
const AdminLogin = lazyRoute(() => import("./pages/AdminLogin"));
const AdminDashboard = lazyRoute(() => import("./pages/AdminDashboard"));
const DelivererLogin = lazyRoute(() => import("./pages/DelivererLogin"));
const DelivererDashboard = lazyRoute(() => import("./pages/DelivererDashboard"));
const OwnerLogin = lazyRoute(() => import("./pages/OwnerLogin"));
const OwnerDashboard = lazyRoute(() => import("./pages/OwnerDashboard"));

const queryClient = new QueryClient();

const ReferralQueryCapture = () => {
  const location = useLocation();

  useEffect(() => {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref) {
      saveReferralCode(ref);
    }
  }, [location.search]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <CartProvider>
          <AdminAuthProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <ReferralQueryCapture />
              <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/r" element={<RestaurantDirectoryPage />} />
                <Route path="/r/:slug" element={<PublicRestaurantPage />} />
                <Route path="/restaurant/:id" element={<LegacyRestaurantRedirect />} />
                <Route path="/order" element={<WhatsAppCheckout />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/order-confirmation/:orderId" element={<OrderConfirmation />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/referrals" element={<ReferralsPage />} />
                <Route path="/my-orders" element={<MyOrders />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/deliverer/login" element={<DelivererLogin />} />
                <Route path="/deliverer" element={<DelivererDashboard />} />
                <Route path="/owner/login" element={<OwnerLogin />} />
                <Route path="/owner" element={<OwnerDashboard />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </BrowserRouter>
          </AdminAuthProvider>
        </CartProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

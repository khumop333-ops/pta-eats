import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { Suspense } from "react";
import RouteFallback from "@/components/RouteFallback";
import { lazyRoute } from "@/lib/lazyRoute";
// Eager: the public storefront — where WhatsApp-shared links and the homepage
// land — must not wait on an extra chunk round-trip on a slow connection.
import Index from "./pages/Index";
import PublicRestaurantPage from "./pages/PublicRestaurantPage";
import RestaurantDirectoryPage from "./pages/RestaurantDirectoryPage";
import NotFound from "./pages/NotFound";

// Lazy: ordering flow, auth, and staff dashboards. Customers no longer
// download admin/owner/driver code they will never use.
const LegacyRestaurantRedirect = lazyRoute(() => import("./pages/LegacyRestaurantRedirect"));
const Checkout = lazyRoute(() => import("./pages/Checkout"));
const OrderConfirmation = lazyRoute(() => import("./pages/OrderConfirmation"));
const AuthPage = lazyRoute(() => import("./pages/AuthPage"));
const MyOrders = lazyRoute(() => import("./pages/MyOrders"));
const AdminLogin = lazyRoute(() => import("./pages/AdminLogin"));
const AdminDashboard = lazyRoute(() => import("./pages/AdminDashboard"));
const DelivererLogin = lazyRoute(() => import("./pages/DelivererLogin"));
const DelivererDashboard = lazyRoute(() => import("./pages/DelivererDashboard"));
const OwnerLogin = lazyRoute(() => import("./pages/OwnerLogin"));
const OwnerDashboard = lazyRoute(() => import("./pages/OwnerDashboard"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <CartProvider>
          <AdminAuthProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/r" element={<RestaurantDirectoryPage />} />
                <Route path="/r/:slug" element={<PublicRestaurantPage />} />
                <Route path="/restaurant/:id" element={<LegacyRestaurantRedirect />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/order-confirmation/:orderId" element={<OrderConfirmation />} />
                <Route path="/auth" element={<AuthPage />} />
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

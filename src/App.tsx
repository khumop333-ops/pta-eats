import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import { AdminAuthProvider } from "@/context/AdminAuthContext";

const Index = lazy(() => import("./pages/Index"));
const RestaurantPage = lazy(() => import("./pages/RestaurantPage"));
const Checkout = lazy(() => import("./pages/Checkout"));
const OrderConfirmation = lazy(() => import("./pages/OrderConfirmation"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const MyOrders = lazy(() => import("./pages/MyOrders"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const DelivererLogin = lazy(() => import("./pages/DelivererLogin"));
const DelivererDashboard = lazy(() => import("./pages/DelivererDashboard"));
const OwnerLogin = lazy(() => import("./pages/OwnerLogin"));
const OwnerDashboard = lazy(() => import("./pages/OwnerDashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));

const App = () => (
    <TooltipProvider>
      <AuthProvider>
        <CartProvider>
          <AdminAuthProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense
                fallback={
                  <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
                    Loading…
                  </div>
                }
              >
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/restaurant/:id" element={<RestaurantPage />} />
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
);

export default App;

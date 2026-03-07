import { useParams, Link } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

const OrderConfirmation = () => {
  const { orderId } = useParams();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto flex flex-col items-center justify-center px-4 py-24 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-secondary/20">
          <CheckCircle className="h-10 w-10 text-secondary" />
        </div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          Thank You for Your Order!
        </h1>
        <p className="mt-3 text-muted-foreground">
          Your order has been placed and the restaurant has been notified.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Order ID: <span className="font-mono font-medium text-foreground">{orderId?.slice(0, 8)}…</span>
        </p>
        <Button asChild className="mt-8">
          <Link to="/">Back to Home</Link>
        </Button>
      </main>
    </div>
  );
};

export default OrderConfirmation;

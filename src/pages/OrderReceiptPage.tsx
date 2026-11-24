import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import StorefrontPageHeader from "@/components/storefront/StorefrontPageHeader";
import StorefrontFooter from "@/components/storefront/StorefrontFooter";
import { OrderReceiptCard } from "@/components/storefront/OrderReceiptCard";
import { Button } from "@/components/ui/button";
import { fetchOrderReceipt, type OrderReceipt } from "@/lib/directOrder";

const OrderReceiptPage = () => {
  const { receiptToken } = useParams<{ receiptToken: string }>();
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadReceipt = useCallback(
    async (isManualRefresh = false) => {
      if (!receiptToken) {
        setReceipt(null);
        setLoading(false);
        return;
      }

      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMessage(null);

      try {
        const data = await fetchOrderReceipt(receiptToken);
        setReceipt(data);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Could not load receipt.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [receiptToken],
  );

  useEffect(() => {
    void loadReceipt(false);
  }, [loadReceipt]);

  return (
    <div className="roma-surface flex min-h-screen flex-col">
      <StorefrontPageHeader backTo="/r" backLabel="Browse restaurants" />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        {receipt && (
          <div className="mb-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadReceipt(true)}
              disabled={refreshing}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh status
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">
              Verifying official receipt with Roma Eats server…
            </p>
          </div>
        ) : errorMessage ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-center">
            <AlertCircle className="mx-auto h-9 w-9 text-destructive" />
            <h1 className="mt-3 text-lg font-bold">Verification error</h1>
            <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void loadReceipt(false)}
            >
              Try again
            </Button>
          </div>
        ) : !receipt ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 text-lg font-bold">Receipt not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              No server-verified order matches this receipt token. Only orders placed directly on
              Roma Eats have an authentic locked receipt.
            </p>
            <Button asChild className="mt-5">
              <Link to="/r">Browse restaurants</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-950 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Authentic Roma Eats database record — prices, delivery fee, and total are locked on
                the server.
              </span>
            </div>

            <OrderReceiptCard receipt={receipt} isStandalonePage />
          </div>
        )}
      </main>
      <StorefrontFooter />
    </div>
  );
};

export default OrderReceiptPage;

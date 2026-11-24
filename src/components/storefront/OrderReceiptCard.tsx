import { useEffect, useState } from "react";
import { Check, Clock, Copy, Download, ExternalLink, Lock, Share2, ShieldCheck, Ticket } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CURRENCY_SYMBOL } from "@/lib/business";
import { buildReceiptUrl, type OrderReceipt } from "@/lib/directOrder";
import {
  downloadReceiptPng,
  formatReceiptSastDate,
  renderReceiptPng,
  shareReceiptImage,
} from "@/lib/receiptImage";

interface OrderReceiptCardProps {
  receipt: OrderReceipt;
  /** Hide the "Open permanent receipt page" link when already on /receipt/:token */
  isStandalonePage?: boolean;
}

export function OrderReceiptCard({ receipt, isStandalonePage = false }: OrderReceiptCardProps) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [busyAction, setBusyAction] = useState<"download" | "share" | null>(null);

  const receiptUrl = buildReceiptUrl(receipt.receipt_token);
  const isFreeDelivery = receipt.delivery_fee === 0;

  useEffect(() => {
    let active = true;
    renderReceiptPng(receipt, receiptUrl).then((generated) => {
      if (active && generated) {
        setPngDataUrl(generated.dataUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [receipt, receiptUrl]);

  const handleDownloadPng = async () => {
    setBusyAction("download");
    try {
      const ok = await downloadReceiptPng(receipt, receiptUrl);
      if (ok) {
        toast.success(`Downloaded ${receipt.order_number} receipt image (PNG)`);
      } else {
        toast.error("Could not generate receipt image in this browser.");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleSharePng = async () => {
    setBusyAction("share");
    try {
      const outcome = await shareReceiptImage(receipt, receiptUrl);
      if (outcome === "shared_file") {
        toast.success("Receipt image ready to share!");
      } else if (outcome === "downloaded_and_copied") {
        toast.success("Receipt PNG downloaded & verified link copied!");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyReceiptUrl = async () => {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopiedLink(true);
      toast.success("Verified receipt link copied!");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error("Could not copy link automatically.");
    }
  };

  return (
    <div className="space-y-4">
      <div
        data-testid="locked-order-receipt"
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      >
        {/* Dark security header */}
        <div className="bg-zinc-950 px-5 py-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              Server-Verified · Locked Receipt
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              <Lock className="h-3 w-3" />
              Immutable Total
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-extrabold tracking-tight">{receipt.order_number}</h2>
            <Badge variant="secondary" className="bg-white/10 text-white hover:bg-white/15">
              Status: {receipt.status}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Placed {formatReceiptSastDate(receipt.created_at)} SAST
          </p>
        </div>

        <div className="space-y-4 p-5">
          {receipt.is_preorder && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold">Pre-order queued for next 08:00 SAST opening</p>
                <p className="text-amber-800/90 dark:text-amber-300/80">
                  Your order is locked in Roma&apos;s system and will be confirmed after reopening.
                </p>
              </div>
            </div>
          )}

          {/* Restaurant */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Restaurant
            </p>
            <p className="text-base font-bold text-foreground">{receipt.restaurant_name}</p>
          </div>

          {/* Itemized lines */}
          <ul className="divide-y divide-border/60 border-y border-border/70 py-2 text-sm">
            {receipt.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 py-2">
                <span className="text-foreground">
                  <span className="font-semibold">{item.quantity}x</span> {item.name}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {CURRENCY_SYMBOL} {item.line_total.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>

          {/* Locked money breakdown */}
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">
                {CURRENCY_SYMBOL} {receipt.subtotal.toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery fee</span>
              {isFreeDelivery ? (
                <span className="flex items-center gap-1.5 tabular-nums">
                  {receipt.standard_delivery_fee > 0 && (
                    <span className="text-xs text-muted-foreground line-through">
                      {CURRENCY_SYMBOL} {receipt.standard_delivery_fee.toFixed(2)}
                    </span>
                  )}
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">FREE</span>
                </span>
              ) : (
                <span className="tabular-nums">
                  {CURRENCY_SYMBOL} {receipt.delivery_fee.toFixed(2)}
                </span>
              )}
            </div>

            {receipt.promo_code && (
              <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-900 dark:text-emerald-200">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Ticket className="h-3.5 w-3.5 text-emerald-600" />
                  Verified free-delivery code
                </span>
                <code className="font-mono font-bold">{receipt.promo_code}</code>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between rounded-xl bg-secondary/70 px-3.5 py-3 text-base font-extrabold">
              <span>Locked Total</span>
              <span className="text-lg tabular-nums">
                {CURRENCY_SYMBOL} {receipt.total.toFixed(2)}
              </span>
            </div>

            <p className="pt-1 text-xs text-muted-foreground">
              Payment: Bank transfer (EFT) or cash on delivery · Paying by EFT? Share this Official
              Receipt PNG image alongside your proof of payment.
            </p>
          </div>

          {/* Customer delivery details */}
          <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/30 p-3.5 text-xs">
            <div className="flex justify-between gap-3">
              <span className="font-medium text-muted-foreground">Customer</span>
              <span className="text-right font-semibold text-foreground">
                {receipt.customer_name}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="font-medium text-muted-foreground">Phone</span>
              <span className="text-right font-medium text-foreground">{receipt.phone_number}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="font-medium text-muted-foreground">Delivery to</span>
              <span className="max-w-[70%] text-right font-medium text-foreground">
                {receipt.delivery_address}
              </span>
            </div>
            {receipt.special_instructions && (
              <div className="flex justify-between gap-3">
                <span className="font-medium text-muted-foreground">Notes</span>
                <span className="max-w-[70%] text-right text-foreground">
                  {receipt.special_instructions}
                </span>
              </div>
            )}
          </div>

          {/* Authenticity token bar */}
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                Verification Token: {receipt.receipt_token.slice(0, 8).toUpperCase()}
              </span>
              {!isStandalonePage && receipt.receipt_token && (
                <Link
                  to={`/receipt/${receipt.receipt_token}`}
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 underline underline-offset-4 hover:text-emerald-800 dark:text-emerald-300"
                >
                  Open receipt page
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>

          {pngDataUrl && (
            <details className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground select-none">
                Preview Official Receipt Image (PNG)
              </summary>
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <img
                  src={pngDataUrl}
                  alt={`Official Roma Eats receipt ${receipt.order_number}`}
                  className="mx-auto max-h-[520px] w-auto"
                />
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Receipt Image & Link actions (never editable order text) */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Button
          type="button"
          onClick={handleSharePng}
          disabled={busyAction !== null}
          className="gap-2"
        >
          <Share2 className="h-4 w-4" />
          {busyAction === "share" ? "Preparing image…" : "Share Receipt Image"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadPng}
          disabled={busyAction !== null}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          {busyAction === "download" ? "Generating…" : "Download PNG"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleCopyReceiptUrl}
          className="gap-2"
        >
          {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiedLink ? "Link Copied" : "Copy Receipt Link"}
        </Button>
      </div>
    </div>
  );
}

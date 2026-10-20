import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Start (or retry) the Yoco hosted checkout for an existing order.
 *
 * `create-yoco-payment` is idempotent per order and refuses orders that are
 * already paid, so calling it again from the confirmation page or My Orders is
 * safe. The order itself is never re-created — only the payment page is.
 */
export async function startYocoCheckout(orderId: string): Promise<{ redirectUrl: string }> {
  const { data, error } = await supabase.functions.invoke("create-yoco-payment", {
    body: { orderId, returnOrigin: window.location.origin },
  });

  if (error) {
    const details =
      error instanceof FunctionsHttpError ? await error.context.text() : error.message;
    console.error("create-yoco-payment failed:", details);
    throw new Error(details || "Could not start card payment.");
  }

  const redirectUrl = (data as { redirectUrl?: string } | null)?.redirectUrl;
  if (!redirectUrl) {
    throw new Error("Yoco did not return a payment page.");
  }

  return { redirectUrl };
}

/** Human-readable reason for the toast, without leaking raw JSON to customers. */
export function paymentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/not configured|YOCO_SECRET_KEY/i.test(message)) {
    return "Card payments aren’t available right now. Please pay cash on delivery or contact Roma.";
  }
  if (/already paid/i.test(message)) {
    return "This order is already paid.";
  }
  return "Could not open the payment page. Please try again in a moment.";
}

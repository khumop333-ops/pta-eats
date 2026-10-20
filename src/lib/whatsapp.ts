export const ROMA_WHATSAPP = import.meta.env.VITE_ROMA_WHATSAPP_NUMBER;

type WhatsAppItem = {
  name: string;
  quantity: number;
  priceCents?: number;
};

export type WhatsAppPaymentMethod = "bank-transfer" | "cash-on-delivery" | "either";

const PAYMENT_LABELS: Record<WhatsAppPaymentMethod, string> = {
  "bank-transfer": "bank transfer",
  "cash-on-delivery": "cash on delivery",
  // Checkout deliberately does not ask the customer to choose up front.
  either: "bank transfer / cash on delivery",
};

export type WhatsAppCustomer = {
  name?: string;
  phone?: string;
  address?: string;
  notes?: string;
};

type BuildWhatsAppLinkOptions = {
  to?: string | null;
  restaurantName: string;
  /** Optional: cart items saved before slugs were stored still get a valid link. */
  restaurantSlug?: string | null;
  items?: WhatsAppItem[];
  /**
   * Supplying the delivery fee switches the summary from "Estimated" (the
   * quick enquiry sent from the restaurant page) to a full
   * Subtotal / Delivery fee / Total block for checkout.
   */
  deliveryFeeCents?: number;
  customer?: WhatsAppCustomer;
  paymentMethod?: WhatsAppPaymentMethod;
};

let hasWarnedMissingRomaNumber = false;

const warnMissingRomaNumber = () => {
  if (hasWarnedMissingRomaNumber) return;

  console.warn(
    "VITE_ROMA_WHATSAPP_NUMBER is not set; WhatsApp order links are disabled until it is configured."
  );
  hasWarnedMissingRomaNumber = true;
};

const formatRand = (priceCents: number) => (priceCents / 100).toFixed(2);

const clean = (value: string | undefined | null) => value?.trim() ?? "";

export const buildWhatsAppLink = ({
  to,
  restaurantName,
  restaurantSlug,
  items,
  deliveryFeeCents,
  customer,
  paymentMethod,
}: BuildWhatsAppLinkOptions): string => {
  const recipient = to || ROMA_WHATSAPP;
  if (!recipient) {
    warnMissingRomaNumber();
    return "";
  }

  const messageLines = [`Hi Roma! I'd like to order from ${restaurantName}:`, ""];

  if (items && items.length > 0) {
    const itemLines = items.map(({ name, quantity, priceCents }) => {
      const price = priceCents === undefined ? "" : ` — R${formatRand(priceCents)}`;
      return `${quantity}x ${name}${price}`;
    });
    const subtotalCents = items.reduce(
      (total, item) => total + (item.priceCents === undefined ? 0 : item.quantity * item.priceCents),
      0
    );

    messageLines.push(...itemLines, "");

    if (deliveryFeeCents === undefined) {
      messageLines.push(`Estimated: R${formatRand(subtotalCents)}`, "");
    } else {
      messageLines.push(
        `Subtotal: R${formatRand(subtotalCents)}`,
        `Delivery fee: R${formatRand(deliveryFeeCents)}`,
        "",
        `Total: R${formatRand(subtotalCents + deliveryFeeCents)}`,
        ""
      );
    }
  }

  // The delivery block is what makes the message actionable without a database
  // order, so it is only emitted when the customer filled the form in.
  const customerLines: string[] = [];
  const name = clean(customer?.name);
  const phone = clean(customer?.phone);
  const address = clean(customer?.address);
  const notes = clean(customer?.notes);

  if (name) customerLines.push(`Name: ${name}`);
  if (phone) customerLines.push(`Phone: ${phone}`);
  if (address) customerLines.push(`Delivery to: ${address}`);
  if (notes) customerLines.push(`Notes: ${notes}`);

  if (customerLines.length > 0) {
    messageLines.push(...customerLines, "");
  }

  if (paymentMethod) {
    messageLines.push(`Payment: ${PAYMENT_LABELS[paymentMethod]}`);
  }

  const slug = clean(restaurantSlug);
  if (slug) {
    messageLines.push(`Sent via roma.africa/r/${slug}`);
  }

  return `https://wa.me/${recipient}?text=${encodeURIComponent(messageLines.join("\n"))}`;
};

/**
 * Returns whether a window was actually opened. Browsers block `window.open`
 * outside a user gesture (in-app browsers on WhatsApp/Facebook are the usual
 * culprits), and the checkout page uses `false` to show a tappable fallback
 * link instead of silently losing the order.
 */
export const openWhatsApp = (link: string): boolean => {
  if (!link) return false;

  try {
    const opened = window.open(link, "_blank", "noopener,noreferrer");
    return Boolean(opened);
  } catch {
    return false;
  }
};

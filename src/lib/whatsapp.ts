export const ROMA_WHATSAPP = import.meta.env.VITE_ROMA_WHATSAPP_NUMBER;

type WhatsAppItem = {
  name: string;
  quantity: number;
  priceCents?: number;
};

type BuildWhatsAppLinkOptions = {
  to?: string | null;
  restaurantName: string;
  restaurantSlug: string;
  items?: WhatsAppItem[];
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

export const buildWhatsAppLink = ({
  to,
  restaurantName,
  restaurantSlug,
  items,
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
    const totalCents = items.reduce(
      (total, item) => total + (item.priceCents === undefined ? 0 : item.quantity * item.priceCents),
      0
    );

    messageLines.push(...itemLines, "", `Estimated: R${formatRand(totalCents)}`, "");
  }

  messageLines.push(`Sent via roma.africa/r/${restaurantSlug}`);

  return `https://wa.me/${recipient}?text=${encodeURIComponent(messageLines.join("\n"))}`;
};

export const openWhatsApp = (link: string) => {
  if (!link) return;

  window.open(link, "_blank", "noopener,noreferrer");
};

import type { OrderReceipt } from "./directOrder";
import { buildReceiptUrl } from "./directOrder";

export interface GeneratedReceiptImage {
  blob: Blob;
  dataUrl: string;
  filename: string;
}

export type ShareReceiptOutcome = "shared_file" | "downloaded_and_copied" | "cancelled";

function formatRand(amount: number): string {
  return `R ${Number(amount).toFixed(2)}`;
}

export function formatReceiptSastDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => resolve(blob), "image/png", 1);
      return;
    }
    resolve(null);
  });
}

export function getReceiptFilename(receipt: OrderReceipt): string {
  const safeOrder = receipt.order_number.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `roma-receipt-${safeOrder}.png`;
}

export async function renderReceiptPng(
  receipt: OrderReceipt,
  customReceiptUrl?: string,
): Promise<GeneratedReceiptImage | null> {
  if (typeof document === "undefined") return null;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) {
    return null;
  }

  const probeCanvas = document.createElement("canvas");
  let probeCtx: CanvasRenderingContext2D | null = null;
  try {
    probeCtx = probeCanvas.getContext("2d");
  } catch {
    return null;
  }
  if (!probeCtx) return null;

  const receiptUrl = customReceiptUrl ?? buildReceiptUrl(receipt.receipt_token);
  const scale = 2;
  const width = 500;
  const pad = 28;
  const innerWidth = width - pad * 2;
  const fontStack = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  // Pre-wrap variable-height text blocks so the canvas height fits snugly.
  probeCtx.font = `500 14px ${fontStack}`;
  const wrappedItems = receipt.items.map((item) => ({
    ...item,
    lines: wrapCanvasText(probeCtx!, `${item.quantity}x ${item.name}`, innerWidth - 110),
  }));

  probeCtx.font = `400 13px ${fontStack}`;
  const addressLines = wrapCanvasText(probeCtx, receipt.delivery_address, innerWidth - 90);
  const notesLines = receipt.special_instructions
    ? wrapCanvasText(probeCtx, receipt.special_instructions, innerWidth - 90)
    : [];
  const urlLines = wrapCanvasText(probeCtx, receiptUrl, innerWidth - 24);

  const itemsHeight = wrappedItems.reduce((sum, item) => sum + item.lines.length * 20 + 10, 0);
  const customerHeight =
    24 + // Customer
    24 + // Phone
    addressLines.length * 19 +
    8 +
    (notesLines.length > 0 ? notesLines.length * 19 + 8 : 0);
  const urlBoxHeight = 44 + urlLines.length * 17;

  const totalHeight =
    158 + // Header + order metadata
    (receipt.is_preorder ? 34 : 0) +
    46 + // Restaurant header
    itemsHeight +
    18 +
    126 + // Totals block
    24 +
    customerHeight +
    22 +
    urlBoxHeight +
    36;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = totalHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  // Outer background
  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, width, totalHeight);

  // White receipt card
  drawRoundedRect(ctx, 14, 14, width - 28, totalHeight - 28, 16);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#e4e4e7";
  ctx.stroke();

  // Dark header band
  drawRoundedRect(ctx, 14, 14, width - 28, 94, 16);
  ctx.fillStyle = "#111827";
  ctx.fill();
  ctx.fillRect(14, 78, width - 28, 30);

  ctx.fillStyle = "#4ade80";
  ctx.font = `700 11px ${fontStack}`;
  ctx.fillText("SERVER-VERIFIED · LOCKED RECEIPT", pad, 42);

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 22px ${fontStack}`;
  ctx.fillText(`ROMA EATS · ${receipt.order_number}`, pad, 70);

  ctx.fillStyle = "#9ca3af";
  ctx.font = `500 12px ${fontStack}`;
  ctx.fillText(`${formatReceiptSastDate(receipt.created_at)} SAST`, pad, 92);

  // Right status pill in header
  const sealText = "LOCKED";
  ctx.font = `700 11px ${fontStack}`;
  const sealWidth = ctx.measureText(sealText).width + 20;
  drawRoundedRect(ctx, width - pad - sealWidth, 30, sealWidth, 24, 12);
  ctx.fillStyle = "rgba(74, 222, 128, 0.16)";
  ctx.fill();
  ctx.fillStyle = "#4ade80";
  ctx.fillText(sealText, width - pad - sealWidth + 10, 46);

  let y = 132;

  if (receipt.is_preorder) {
    drawRoundedRect(ctx, pad, y - 16, innerWidth, 28, 8);
    ctx.fillStyle = "#fef3c7";
    ctx.fill();
    ctx.fillStyle = "#92400e";
    ctx.font = `700 12px ${fontStack}`;
    ctx.fillText("PRE-ORDER · Scheduled for next 08:00 SAST opening", pad + 12, y + 2);
    y += 34;
  }

  // Restaurant title
  ctx.fillStyle = "#71717a";
  ctx.font = `600 11px ${fontStack}`;
  ctx.fillText("RESTAURANT", pad, y);
  y += 20;

  ctx.fillStyle = "#111827";
  ctx.font = `700 17px ${fontStack}`;
  ctx.fillText(receipt.restaurant_name, pad, y);
  y += 16;

  // Divider
  ctx.strokeStyle = "#e4e4e7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  y += 22;

  // Itemized lines
  for (const item of wrappedItems) {
    ctx.fillStyle = "#18181b";
    ctx.font = `500 14px ${fontStack}`;
    item.lines.forEach((line, idx) => {
      ctx.fillText(line, pad, y + idx * 20);
    });

    const priceText = formatRand(item.line_total);
    ctx.font = `600 14px ${fontStack}`;
    const priceW = ctx.measureText(priceText).width;
    ctx.fillText(priceText, width - pad - priceW, y);

    y += item.lines.length * 20 + 10;
  }

  // Dashed divider before totals
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#d4d4d8";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  ctx.restore();
  y += 22;

  // Subtotal
  ctx.fillStyle = "#52525b";
  ctx.font = `500 13px ${fontStack}`;
  ctx.fillText("Subtotal", pad, y);
  const subText = formatRand(receipt.subtotal);
  ctx.fillText(subText, width - pad - ctx.measureText(subText).width, y);
  y += 22;

  // Delivery fee
  ctx.fillStyle = "#52525b";
  ctx.fillText("Delivery fee", pad, y);
  if (receipt.delivery_fee === 0) {
    const freeLabel = receipt.promo_code ? `FREE (${receipt.promo_code})` : "FREE";
    ctx.fillStyle = "#15803d";
    ctx.font = `700 13px ${fontStack}`;
    ctx.fillText(freeLabel, width - pad - ctx.measureText(freeLabel).width, y);
  } else {
    const feeText = formatRand(receipt.delivery_fee);
    ctx.fillText(feeText, width - pad - ctx.measureText(feeText).width, y);
  }
  y += 18;

  // Total highlight box
  drawRoundedRect(ctx, pad, y, innerWidth, 46, 10);
  ctx.fillStyle = "#f4f4f5";
  ctx.fill();

  ctx.fillStyle = "#111827";
  ctx.font = `800 16px ${fontStack}`;
  ctx.fillText("LOCKED TOTAL", pad + 14, y + 29);
  const totalText = formatRand(receipt.total);
  ctx.font = `800 19px ${fontStack}`;
  ctx.fillText(totalText, width - pad - 14 - ctx.measureText(totalText).width, y + 29);
  y += 62;

  // Payment method note
  ctx.fillStyle = "#52525b";
  ctx.font = `500 12px ${fontStack}`;
  ctx.fillText("Payment: Bank transfer (EFT) or Cash on delivery", pad, y);
  y += 22;

  // Divider before customer details
  ctx.strokeStyle = "#e4e4e7";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  y += 20;

  const drawKeyValue = (label: string, lines: string[]) => {
    ctx.fillStyle = "#71717a";
    ctx.font = `600 12px ${fontStack}`;
    ctx.fillText(label, pad, y);

    ctx.fillStyle = "#18181b";
    ctx.font = `500 13px ${fontStack}`;
    lines.forEach((line, idx) => {
      ctx.fillText(line, pad + 88, y + idx * 19);
    });
    y += Math.max(24, lines.length * 19 + 6);
  };

  drawKeyValue("Customer", [receipt.customer_name]);
  drawKeyValue("Phone", [receipt.phone_number]);
  drawKeyValue("Address", addressLines);
  if (notesLines.length > 0) {
    drawKeyValue("Notes", notesLines);
  }

  y += 6;

  // Verification box
  drawRoundedRect(ctx, pad, y, innerWidth, urlBoxHeight, 10);
  ctx.fillStyle = "#f0fdf4";
  ctx.fill();
  ctx.strokeStyle = "#bbf7d0";
  ctx.stroke();

  ctx.fillStyle = "#166534";
  ctx.font = `700 11px ${fontStack}`;
  ctx.fillText(
    `VERIFY AUTHENTICITY · TOKEN ${receipt.receipt_token.slice(0, 8).toUpperCase()}`,
    pad + 12,
    y + 20,
  );

  ctx.fillStyle = "#15803d";
  ctx.font = `500 11px ${fontStack}`;
  urlLines.forEach((line, idx) => {
    ctx.fillText(line, pad + 12, y + 38 + idx * 17);
  });

  const dataUrl = canvas.toDataURL("image/png");
  const blob = await canvasToBlob(canvas);
  if (!blob) return null;

  return {
    blob,
    dataUrl,
    filename: getReceiptFilename(receipt),
  };
}

export async function downloadReceiptPng(
  receipt: OrderReceipt,
  customReceiptUrl?: string,
): Promise<boolean> {
  const generated = await renderReceiptPng(receipt, customReceiptUrl);
  if (!generated) return false;

  const objectUrl = URL.createObjectURL(generated.blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = generated.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

export async function shareReceiptImage(
  receipt: OrderReceipt,
  customReceiptUrl?: string,
): Promise<ShareReceiptOutcome> {
  const receiptUrl = customReceiptUrl ?? buildReceiptUrl(receipt.receipt_token);
  const generated = await renderReceiptPng(receipt, receiptUrl);

  if (generated && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    const file = new File([generated.blob], generated.filename, { type: "image/png" });
    const canShareFiles =
      typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

    if (canShareFiles) {
      try {
        await navigator.share({
          files: [file],
          title: `Roma Eats Receipt ${receipt.order_number}`,
        });
        return "shared_file";
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return "cancelled";
        }
      }
    }
  }

  // Fallback for desktop browsers that cannot share PNG files natively:
  // download the locked PNG receipt image and copy the verified receipt URL.
  if (generated) {
    const objectUrl = URL.createObjectURL(generated.blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = generated.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(receiptUrl);
    } catch {
      // Clipboard permission optional
    }
  }

  return "downloaded_and_copied";
}

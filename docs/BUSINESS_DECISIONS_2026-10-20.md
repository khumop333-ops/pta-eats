# Roma — Business decisions (20 October 2026)

Decisions made by the owner on 20 Oct 2026, and what shipped for them.

## Checkout is now bank transfer / cash on delivery, sent via WhatsApp

The old checkout asked the customer to choose card or cash and wrote an order to
Supabase. That is not how Roma works today, so the live flow changed:

| Decision | Detail | Status in code |
|---|---|---|
| **No payment-method question** | The customer is shown **how** to pay (bank transfer details and cash on delivery) but is not forced to pick one. The WhatsApp message says both are possible and Roma confirms in the chat. | ✅ `src/pages/WhatsAppCheckout.tsx` (`/order`) — no radio buttons. |
| **Bank details come from the owner** | Shown as account holder, bank, account number and branch code, each with a copy button. The payment reference is the customer's own name + phone, so an incoming transfer can be matched to a WhatsApp message. | ✅ `src/config/bankTransfer.ts` — the one file to edit. ⏳ **Still waiting on Roma's real details** (see below). |
| **Cash on delivery stays** | "Pay the driver when your food arrives", with the full total shown. | ✅ Same page. |
| **Order goes to WhatsApp, not the database** | One itemised message to Roma (`27612821819`) with lines, **subtotal, delivery fee R20 and total**, then name, phone, address, notes and payment line. No order is written to Supabase, so nothing appears in Admin or My Orders. | ✅ `src/lib/whatsapp.ts` extended (single builder, no duplicate). Accepted as reversible: order-first + WhatsApp with an order number is a small change later. |
| **No login needed** | Guests can order; the name/phone/address fields are required because they are what makes the WhatsApp message usable. | ✅ The page never touches auth (the old `/checkout` redirected guests to `/auth`). |
| **Opening hours still apply** | Sending is blocked outside 08:00–18:00. | ✅ `isOpenNow()` / `CLOSED_MESSAGE` in `src/lib/business.ts`. |
| **Legacy checkout kept, dormant** | `/checkout`, the Yoco pages and all Yoco code stay in the repo and stay routed, but nothing in the storefront links to them any more — reachable by direct URL only. | ✅ Repointed the cart drawer and the restaurant page's order bar to `/order`. Card checkout can be switched back on once Yoco keys exist. |

## Owner to-do

1. **Send Roma's bank details** — bank name, account holder, account number,
   branch code. They go in `src/config/bankTransfer.ts` (one small file, four
   values, clearly marked). Until then checkout shows a calm "bank details
   coming soon" box and customers can still pay cash or ask on WhatsApp. **No
   account numbers are ever invented in code.**
2. Nothing else — WhatsApp ordering needs no new keys or services.

## How to check it

Open any restaurant, add dishes, tap **Checkout**, fill in name, phone and
address, then **Send order on WhatsApp**. The message should list the items,
the R20 delivery fee and the total, followed by the customer's details and the
payment line. After sending, the cart is emptied and a "Message Roma on WhatsApp
again" button remains, in case the browser blocked the WhatsApp window.

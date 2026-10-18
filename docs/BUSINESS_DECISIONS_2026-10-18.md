# Roma — Business decisions (18 October 2026)

Decisions made by the owner on 18 Oct 2026. Code updated the same day where possible.

| Decision | Detail | Status in code |
|---|---|---|
| **WhatsApp orders go to Roma centrally** | 061 282 1819 → international format `27612821819`. Restaurants do **not** receive WhatsApp orders directly. | ✅ `VITE_ROMA_WHATSAPP_NUMBER` set locally; public restaurant pages now always message Roma (per-restaurant numbers ignored). **Owner must still set this variable in Vercel** (see below). |
| **Payment gateway: Yoco** (replaces iKhokha) | Yoco hosted checkout + signed webhooks. | ✅ iKhokha Edge Functions deleted; new `create-yoco-payment` + `yoco-webhook` (Svix-style HMAC verification, amount check, order resolved via metadata/checkout id). Checkout copy updated. **Blocked on owner's Yoco secrets + webhook registration** (see below). |
| **Delivery fee: R20** | Up from R15. | ✅ `src/lib/business.ts` (frontend) + `create-order` Edge Function both set to 20, cross-referenced with comments. |
| **No minimum order amount** | Customers may order any amount; delivery fee still applies. | ✅ Nothing to build — recorded so nobody adds one. |
| **Opening hours: 08:00–18:00** | Assumed **daily**, Africa/Johannesburg time, for Roma ordering as a whole (not per-restaurant yet). | ✅ `src/lib/business.ts` (`isOpenNow`); checkout refuses submission and public pages disable the WhatsApp button outside hours. ⚠️ Owner to confirm: every day incl. weekends/public holidays? Per-restaurant hours later if needed. |
| **Menus from restaurant owners** | Owner is collecting menus directly from restaurant owners. | ⏳ Waiting on owners. Use `docs/MENU_INTAKE_TEMPLATE.md` — send it to each owner on WhatsApp; returned menus can be pasted to the agent and converted into admin entries/seed data. |

## Owner to-do (production accounts — only the owner can do these)

1. **Vercel** → Project → Settings → Environment Variables (Production + Preview):
   `VITE_ROMA_WHATSAPP_NUMBER` = `27612821819` → then redeploy.
2. **Yoco Portal** (Online payments → Payment gateway): copy the **live secret key** (`sk_live_…`). Keep test key (`sk_test_…`) for staging.
3. **Supabase** → Edge Functions → Secrets: add `YOCO_SECRET_KEY` (live key), and `YOCO_WEBHOOK_SECRET` (from step 4). Old `IKHOKHA_*` secrets can be deleted.
4. **Yoco Portal → Webhooks**: register endpoint `https://jxfjbxrrbpfibdhwlhyh.supabase.co/functions/v1/yoco-webhook`, subscribe to payment completed/failed events, copy its signing secret (`whsec_…`) into `YOCO_WEBHOOK_SECRET` (step 3).
5. **Deploy the new Edge Functions** (`create-yoco-payment`, `yoco-webhook`) — via `supabase functions deploy` or by merging the PR; delete the deployed iKhokha functions in the Supabase dashboard (removing them from the repo does not undeploy them).
6. **Test payment**: with the *test* key first — place a card order, confirm it lands on Yoco's page, pay with a test card, confirm the order flips to `paid` by webhook, and you're returned to the confirmation page. Then swap in the live key and do one small real payment.

## Notes / assumptions to confirm

- Hours assumed **7 days a week**. If Sundays differ, say so and per-day hours are a small change.
- Hours apply to the whole Roma service. If individual restaurants keep different hours, that's the per-restaurant `opening_hours` work in the remediation plan — not built yet.
- Yoco webhook payload nesting is handled defensively (order resolvable via `metadata.orderId` **or** stored checkout id; amount verified when reported). The first real test payment (step 6) is the proof — check the `yoco-webhook` function logs if the order doesn't flip to `paid`.

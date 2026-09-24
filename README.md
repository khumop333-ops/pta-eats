# Roma

Roma is a Pretoria Central food-delivery app built with React, Vite, Tailwind, and Supabase.

## Local development

```sh
npm ci
cp .env.example .env
npm run dev
```

Set these browser-safe variables in `.env`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

The publishable Supabase key is safe to expose in the browser. Never put a Supabase service-role key, database password, or iKhokha secret in `.env`, frontend code, or Git.

## Connect Supabase from Arena

The Supabase project used by this checkout is `jxfjbxrrbpfibdhwlhyh`. Authentication must be completed interactively by the project owner in the Arena terminal or a connected Supabase integration; credentials must not be sent in chat.

```sh
npx supabase login
npx supabase link --project-ref jxfjbxrrbpfibdhwlhyh
npx supabase db push --linked --skip-vault
```

`supabase login` opens the Supabase authentication flow. If it asks for an access token, create one in the Supabase account settings and paste it only into the terminal prompt. `supabase link` may also ask for the database password; enter it only into that prompt. These are not the browser publishable key.

After the migration is applied, deploy the functions:

```sh
npx supabase functions deploy create-order --project-ref jxfjbxrrbpfibdhwlhyh --use-api
npx supabase functions deploy create-ikhokha-payment --project-ref jxfjbxrrbpfibdhwlhyh --use-api
npx supabase functions deploy ikhokha-webhook --project-ref jxfjbxrrbpfibdhwlhyh --use-api --no-verify-jwt
npx supabase functions deploy admin-create-user --project-ref jxfjbxrrbpfibdhwlhyh --use-api
```

The webhook is deliberately configured with `verify_jwt = false` in `supabase/config.toml`, because iKhokha does not send a Supabase JWT. The webhook still verifies the iKhokha application ID and HMAC signature before reading or changing an order. Do not disable JWT verification on the customer or admin functions.

## iK Pay API / hosted pay link

This project uses iKhokha's iK Pay API to create a one-time hosted payment link for each card order. It does not collect card details in the Roma frontend. The official endpoint and signing rules are documented at [developer.ikhokha.com/overview](https://developer.ikhokha.com/overview).

Create a temporary secrets file outside the repository, then upload the secrets to Supabase. Replace the placeholders locally; never commit this file or paste its contents into chat:

```sh
cat >/tmp/roma-ikhokha.env <<'EOF'
IKHOKHA_APP_ID=your_application_id
IKHOKHA_APP_SECRET=your_application_secret
IKHOKHA_MODE=live
APP_ALLOWED_ORIGINS=https://your-production-domain.example,https://your-preview-domain.example
EOF

npx supabase secrets set \
  --project-ref jxfjbxrrbpfibdhwlhyh \
  --env-file /tmp/roma-ikhokha.env
rm -f /tmp/roma-ikhokha.env
```

`APP_ALLOWED_ORIGINS` must contain every site origin that may start a payment. Use comma-separated origins with no path. For local testing, include `http://localhost:5173` (or the actual Vite port). `IKHOKHA_MODE` must be the value supplied for the merchant's iKhokha test credentials; use `live` only with production credentials.

The payment flow is:

1. `create-order` creates and retains the order using the server-calculated total.
2. `create-ikhokha-payment` authenticates the customer, validates ownership, signs the exact iKhokha request server-side, and calls `https://api.ikhokha.com/public-api/v1/api/payment`.
3. The browser is redirected to the returned HTTPS `paylinkUrl`; card details remain on iKhokha's hosted page.
4. iKhokha calls `https://YOUR_PROJECT.supabase.co/functions/v1/ikhokha-webhook`. The webhook verifies `IK-APPID` and `IK-SIGN`, checks the order and amount when supplied, and marks the order paid or failed.
5. A failed or cancelled attempt keeps the order. The customer can retry card payment; each retry gets a fresh external transaction ID. The customer can also switch the unpaid order to cash on delivery.

Verify these cases with iKhokha test credentials or a merchant-approved test mode before going live:

- successful card payment changes the order to `paid`;
- decline and cancellation leave the order retryable;
- a retry creates a fresh pay link;
- switching to cash prevents a later card callback from changing the order back;
- a replayed or late failure callback cannot undo a paid order;
- callbacks with a bad signature, app ID, order ID, or amount are rejected.

## Connect Vercel from Arena

Authenticate the Vercel CLI interactively, link the current repository, and configure the browser variables as project environment variables:

```sh
npx vercel login
npx vercel link

npx vercel env add VITE_SUPABASE_URL production
npx vercel env add VITE_SUPABASE_PROJECT_ID production
npx vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production

npx vercel --prod
```

Repeat `vercel env add` for `preview` and `development` if those deployments need to use Supabase. The commands prompt for values; do not put the values in Git. The same settings can be entered in **Vercel Project → Settings → Environment Variables**. Set the project framework to Vite, use `npm run build`, and keep the output directory as `dist`.

The rewrite in `vercel.json` keeps React Router client-side routes working after a direct refresh. The production origin must also be added to Supabase's `APP_ALLOWED_ORIGINS` secret before card checkout is enabled.

## Quality checks

```sh
npm run build
npm run lint
npm test
npx tsc -p tsconfig.app.json --noEmit
npm audit
```

## Deployment order

1. Authenticate and link Supabase.
2. Apply the migrations, including the database-backed rate limiter.
3. Set the iKhokha and allowed-origin Supabase secrets.
4. Deploy all four Edge Functions.
5. Configure the Vercel browser environment variables and deploy the site.
6. Configure/confirm the iKhokha merchant API credentials and run the payment smoke tests above.

The production bundle lazy-loads route code and the Supabase SDK. Keep an eye on the Vite build report when adding dependencies so the shared chunk does not grow again.

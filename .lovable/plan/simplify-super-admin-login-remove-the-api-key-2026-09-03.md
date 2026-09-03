# Simplify Super Admin Login (Remove the API Key)

Goal: sign in at `/admin/login` with just email + password. No Admin API Key field, no shared secret to remember.

## What changes for you

- The Super Admin login becomes a normal account login: **email + password**.
- The hardcoded `restaurant` / `pretoria123` username login goes away, replaced by a real admin account stored in the backend (I'll create one for you and you tell me the email/password you want, or I generate and hand it over).
- Creating deliverer and restaurant-owner accounts keeps working — it just uses your signed-in admin session instead of a pasted key.

## Why not simply delete the key field

The key is currently what proves to the backend that the account-creation function is being called by an admin. If it's removed with nothing behind it, anyone could call that function and create staff accounts. Using a real admin login instead is both simpler for you and safer.

## Technical details

1. **Admin account + role**: create one auth user, insert `('admin')` into `user_roles` for it (RBAC table already exists with `has_role`).
2. **`AdminAuthContext.tsx`**: drop `adminSecret`, the hardcoded username/password, and sessionStorage flags. Back it with the real session: `onAuthStateChange` + `getUser()`, then verify `has_role(uid, 'admin')`. Expose `isAuthenticated`, `loading`, `login(email, password)`, `logout()`.
3. **`AdminLogin.tsx`**: email + password fields only; reject sign-in (and sign out) if the user lacks the `admin` role, mirroring `OwnerLogin.tsx`.
4. **`admin-create-user` edge function**: remove the `x-admin-secret` check. Instead read the `Authorization` bearer, call `auth.getUser()`, and require `has_role(user.id, 'admin')`; return 403 otherwise. Keep `verify_jwt` behaviour consistent with the auth header being forwarded.
5. **`DelivererManager.tsx` / `RestaurantOwnerAssign.tsx`**: stop reading `adminSecret`; call the function via `supabase.functions.invoke`, which attaches the session token automatically.
6. **Admin dashboard guard**: redirect to `/admin/login` while unauthenticated, respecting the new `loading` state so it doesn't flash.
7. `ADMIN_API_SECRET` becomes unused and can be deleted afterwards.

## Out of scope

Owner login, deliverer login, and customer auth stay exactly as they are.

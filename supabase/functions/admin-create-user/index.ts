import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Rough abuse brake: this function creates real auth users, so cap how many a
// single admin session can create in a short window. Per-isolate and therefore
// best-effort (it resets when the instance is recycled), but it stops a
// compromised admin token from mass-provisioning accounts.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 25
const creationTimestamps = new Map<string, number[]>()

function isRateLimited(adminUserId: string): boolean {
  const now = Date.now()
  const recent = (creationTimestamps.get(adminUserId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )
  if (recent.length >= RATE_LIMIT_MAX) {
    creationTimestamps.set(adminUserId, recent)
    return true
  }
  recent.push(now)
  creationTimestamps.set(adminUserId, recent)
  return false
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const ALLOWED_ROLES = ['deliverer', 'restaurant_owner'] as const

// Must stay at or above the Supabase project's own password length setting, or
// auth.admin.createUser rejects the request with a confusing provider error.
const MIN_PASSWORD_LENGTH = 8

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: userData, error: userErr } = await admin.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )

    if (userErr || !userData.user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const { data: isAdmin, error: roleCheckErr } = await admin.rpc('has_role', {
      _user_id: userData.user.id,
      _role: 'admin',
    })

    if (roleCheckErr || isAdmin !== true) {
      return json({ error: 'Admin access required' }, 403)
    }

    if (isRateLimited(userData.user.id)) {
      return json({ error: 'Too many accounts created. Try again shortly.' }, 429)
    }

    const body = await req.json()
    const { email, password, full_name, role, restaurant_id } = body ?? {}

    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      return json({ error: 'A valid email address is required' }, 400)
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        400,
      )
    }

    if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role as typeof ALLOWED_ROLES[number])) {
      return json({ error: 'Invalid role' }, 400)
    }

    if (
      full_name !== undefined &&
      full_name !== null &&
      (typeof full_name !== 'string' || full_name.length > 120)
    ) {
      return json({ error: 'Invalid full name' }, 400)
    }

    if (restaurant_id !== undefined && typeof restaurant_id !== 'number') {
      return json({ error: 'Invalid restaurant id' }, 400)
    }

    // For a restaurant owner the link is the whole point of the account, so
    // require it rather than silently creating an owner with no restaurant.
    if (role === 'restaurant_owner' && typeof restaurant_id !== 'number') {
      return json({ error: 'A restaurant must be selected for an owner account' }, 400)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: typeof full_name === 'string' ? full_name.trim() : '' },
    })

    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Failed to create user' }, 400)
    }

    const userId = created.user.id

    // Anything that fails after this point must roll the auth user back, otherwise
    // we leave an account that can never sign in usefully and whose email can never
    // be reused for a real staff member.
    const rollback = async () => {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) {
        console.error(`admin-create-user: rollback failed for ${userId}:`, error.message)
      }
    }

    // Verify the restaurant exists and is not already owned before creating the
    // account, so we never link an owner to nothing.
    if (role === 'restaurant_owner') {
      const { data: restaurant, error: restErr } = await admin
        .from('restaurants')
        .select('id, owner_id')
        .eq('id', restaurant_id)
        .maybeSingle()

      if (restErr || !restaurant) {
        await rollback()
        return json({ error: 'Restaurant not found' }, 400)
      }

      if (restaurant.owner_id && restaurant.owner_id !== userId) {
        await rollback()
        return json({ error: 'That restaurant already has an owner' }, 409)
      }
    }

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: userId, role })

    if (roleErr) {
      await rollback()
      return json({ error: `Role assign failed: ${roleErr.message}` }, 500)
    }

    if (role === 'restaurant_owner') {
      const { data: linked, error: updErr } = await admin
        .from('restaurants')
        .update({ owner_id: userId })
        .eq('id', restaurant_id)
        .select('id')

      if (updErr || !linked || linked.length === 0) {
        await rollback()
        return json({ error: `Restaurant link failed: ${updErr?.message ?? 'no rows updated'}` }, 500)
      }
    }

    return json({ user_id: userId }, 200)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

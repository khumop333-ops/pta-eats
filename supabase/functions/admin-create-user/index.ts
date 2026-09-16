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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'User service is not configured' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: userData, error: userErr } = await admin.auth.getUser(
      authHeader.replace(/^Bearer\s+/, ''),
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

    const body = await req.json()
    const { email, password, full_name, role, restaurant_id } = body ?? {}
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const normalizedName = typeof full_name === 'string' ? full_name.trim().slice(0, 120) : ''

    if (
      !normalizedEmail ||
      !/^\S+@\S+\.\S+$/.test(normalizedEmail) ||
      typeof password !== 'string' ||
      password.length < 6 ||
      !['deliverer', 'restaurant_owner'].includes(role)
    ) {
      return json({ error: 'Invalid input' }, 400)
    }

    let restaurantId: number | null = null
    let previousOwnerId: string | null = null
    if (role === 'restaurant_owner') {
      if (!Number.isInteger(restaurant_id) || restaurant_id <= 0) {
        return json({ error: 'A valid restaurant is required for an owner account' }, 400)
      }
      restaurantId = restaurant_id
      const { data: restaurant, error: restaurantErr } = await admin
        .from('restaurants')
        .select('id, owner_id')
        .eq('id', restaurantId)
        .maybeSingle()
      if (restaurantErr || !restaurant) {
        return json({ error: 'Restaurant not found' }, 400)
      }
      previousOwnerId = restaurant.owner_id ?? null
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: normalizedName },
    })

    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Failed to create user' }, 400)
    }

    const userId = created.user.id
    const rollbackUser = async () => {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(userId)
      if (rollbackError) {
        console.error('Could not roll back partially-created user:', rollbackError.message)
      }
    }

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: userId, role })

    if (roleErr) {
      await rollbackUser()
      return json({ error: 'Role assignment failed; no account was created' }, 500)
    }

    if (restaurantId !== null) {
      const { error: updateErr } = await admin
        .from('restaurants')
        .update({ owner_id: userId })
        .eq('id', restaurantId)

      if (updateErr) {
        await admin
          .from('restaurants')
          .update({ owner_id: previousOwnerId })
          .eq('id', restaurantId)
        await rollbackUser()
        return json({ error: 'Restaurant link failed; no account was created' }, 500)
      }
    }

    return json({ user_id: userId }, 200)
  } catch (e) {
    console.error('admin-create-user error:', e)
    return json({ error: 'Could not create account' }, 500)
  }
})

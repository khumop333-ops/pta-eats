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

    const body = await req.json()
    const { email, password, full_name, role, restaurant_id } = body ?? {}

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      typeof role !== 'string' ||
      password.length < 6 ||
      !['deliverer', 'restaurant_owner'].includes(role)
    ) {
      return json({ error: 'Invalid input' }, 400)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    })

    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Failed to create user' }, 400)
    }

    const userId = created.user.id

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: userId, role })

    if (roleErr) {
      return json({ error: `Role assign failed: ${roleErr.message}` }, 500)
    }

    if (role === 'restaurant_owner' && typeof restaurant_id === 'number') {
      const { error: updErr } = await admin
        .from('restaurants')
        .update({ owner_id: userId })
        .eq('id', restaurant_id)

      if (updErr) {
        return json({ error: `Restaurant link failed: ${updErr.message}` }, 500)
      }
    }

    return json({ user_id: userId }, 200)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

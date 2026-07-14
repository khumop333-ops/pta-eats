import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const providedSecret = req.headers.get('x-admin-secret')
    const expected = Deno.env.get('ADMIN_API_SECRET')
    if (!expected || providedSecret !== expected) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      return new Response(JSON.stringify({ error: 'Invalid input' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    })

    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Failed to create user' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = created.user.id

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: userId, role })

    if (roleErr) {
      return new Response(JSON.stringify({ error: `Role assign failed: ${roleErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (role === 'restaurant_owner' && typeof restaurant_id === 'number') {
      const { error: updErr } = await admin
        .from('restaurants')
        .update({ owner_id: userId })
        .eq('id', restaurant_id)

      if (updErr) {
        return new Response(JSON.stringify({ error: `Restaurant link failed: ${updErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({ user_id: userId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// One-time bootstrap: creates the very first admin account.
// Refuses to do anything once an admin already exists.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { count, error: countErr } = await admin
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')

    if (countErr) return json({ error: countErr.message }, 500)
    if ((count ?? 0) > 0) return json({ error: 'An admin already exists' }, 403)

    const { email, password, full_name } = (await req.json()) ?? {}
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
      return json({ error: 'Invalid input' }, 400)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? 'Super Admin' },
    })

    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Failed to create admin' }, 400)
    }

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: created.user.id, role: 'admin' })

    if (roleErr) return json({ error: roleErr.message }, 500)

    return json({ user_id: created.user.id }, 200)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'

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

const BodySchema = z.object({
  order_id: z.string().uuid(),
  deliverer_id: z.string().uuid(),
})

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }
    if (req.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: userData, error: userErr } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    if (userErr || !userData.user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: adminRole, error: adminRoleErr } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin')
      .maybeSingle()

    if (adminRoleErr) throw adminRoleErr
    if (!adminRole) return json({ error: 'forbidden' }, 403)

    let body: unknown
    try {
      body = await req.json()
    } catch (err) {
      if (err instanceof SyntaxError) return json({ error: 'invalid_input' }, 400)
      throw err
    }
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) return json({ error: 'invalid_input' }, 400)
    const { order_id, deliverer_id } = parsed.data

    const { data: delivererRole, error: delivererRoleErr } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('user_id', deliverer_id)
      .eq('role', 'deliverer')
      .maybeSingle()

    if (delivererRoleErr) throw delivererRoleErr
    if (!delivererRole) return json({ error: 'not_a_deliverer' }, 400)

    const { data: orders, error: updateErr } = await admin
      .from('orders')
      .update({ deliverer_id })
      .eq('id', order_id)
      .select('id')

    if (updateErr) throw updateErr
    if (orders.length === 0) return json({ error: 'order_not_found' }, 404)

    return json({ ok: true, order_id })
  } catch (err) {
    console.error('assign-deliverer error:', err)
    return json({ error: 'internal' }, 500)
  }
})

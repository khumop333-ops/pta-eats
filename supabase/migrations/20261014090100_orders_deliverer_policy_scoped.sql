-- Phase 1.3 — scope deliverer access to orders.deliverer_id = auth.uid().
-- Rollback: drop the three "Deliverers can ..." policies; recreate the prior broad versions from git history.

drop policy if exists "Deliverers can update orders" on public.orders;
drop policy if exists "Deliverers can view orders" on public.orders;
drop policy if exists "Deliverers can view order items" on public.order_items;

create policy "Deliverers can update assigned orders"
on public.orders
for update
to authenticated
using (
  public.has_role(auth.uid(), 'deliverer')
  and deliverer_id = auth.uid()
)
with check (
  public.has_role(auth.uid(), 'deliverer')
  and deliverer_id = auth.uid()
);

create policy "Deliverers can view assigned orders"
on public.orders
for select
to authenticated
using (
  public.has_role(auth.uid(), 'deliverer')
  and deliverer_id = auth.uid()
);

create policy "Deliverers can view assigned order items"
on public.order_items
for select
to authenticated
using (
  public.has_role(auth.uid(), 'deliverer')
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.deliverer_id = auth.uid()
  )
);

-- Phase 1.2 — index on orders.deliverer_id.
-- Rollback: drop index orders_deliverer_id_idx;

create index if not exists orders_deliverer_id_idx
  on public.orders (deliverer_id)
  where deliverer_id is not null;

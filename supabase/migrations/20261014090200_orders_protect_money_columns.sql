-- Phase 1.4 — block non-admin edits to money and ownership columns on orders.
-- Rollback: drop trigger orders_protect_money on public.orders; drop function public.protect_order_money_columns();

create or replace function public.protect_order_money_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role / webhook / migration context
  if auth.uid() is null then
    return new;
  end if;

  -- admins may edit anything
  if public.has_role(auth.uid(), 'admin') then
    return new;
  end if;

  if new.total             is distinct from old.total
  or new.subtotal          is distinct from old.subtotal
  or new.delivery_fee      is distinct from old.delivery_fee
  or new.user_id           is distinct from old.user_id
  or new.restaurant_id     is distinct from old.restaurant_id
  or new.payment_method    is distinct from old.payment_method
  or new.payment_status    is distinct from old.payment_status
  or new.payment_reference is distinct from old.payment_reference
  or new.paid_at           is distinct from old.paid_at
  then
    raise exception 'cannot edit money or ownership columns'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_protect_money on public.orders;

create trigger orders_protect_money
  before update on public.orders
  for each row
  execute function public.protect_order_money_columns();

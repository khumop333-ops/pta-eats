-- restaurants is publicly readable, so this check does not need elevated rights
CREATE OR REPLACE FUNCTION public.owns_restaurant(_user_id uuid, _restaurant_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE id = _restaurant_id AND owner_id = _user_id
  )
$$;

REVOKE ALL ON FUNCTION public.owns_restaurant(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_restaurant(uuid, integer) TO authenticated, service_role;
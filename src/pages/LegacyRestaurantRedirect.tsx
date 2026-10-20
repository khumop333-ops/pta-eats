import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import RouteFallback from "@/components/RouteFallback";
import { fetchRestaurantById } from "@/data/restaurants";

/**
 * Old `/restaurant/:id` links (shared before the merge, and still printed on a
 * few QR codes) permanently resolve to the canonical `/r/:slug` page, which is
 * the only restaurant page that now carries the cart.
 */
const LegacyRestaurantRedirect = () => {
  const { id } = useParams();
  const [slug, setSlug] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    setResolved(false);

    fetchRestaurantById(Number(id))
      .then((restaurant) => {
        if (!active) return;
        setSlug(restaurant?.slug ?? null);
        setResolved(true);
      })
      .catch(() => {
        if (!active) return;
        setSlug(null);
        setResolved(true);
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (!resolved) return <RouteFallback />;

  return <Navigate to={slug ? `/r/${slug}` : "/r"} replace />;
};

export default LegacyRestaurantRedirect;

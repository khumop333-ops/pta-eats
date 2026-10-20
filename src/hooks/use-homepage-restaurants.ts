import { useQuery } from "@tanstack/react-query";
import { fetchRestaurants } from "@/data/restaurants";

export const HOMEPAGE_RESTAURANTS_KEY = ["homepage-restaurants"] as const;

/**
 * Listed restaurants + menus for the homepage. Shared by the hero search and
 * the featured grid through React Query's cache, so the page makes one request.
 */
export function useHomepageRestaurants() {
  return useQuery({
    queryKey: HOMEPAGE_RESTAURANTS_KEY,
    queryFn: fetchRestaurants,
    staleTime: 5 * 60 * 1000,
    // One quick retry, then show the error state rather than a long skeleton
    // on a poor mobile connection; the UI offers a manual retry.
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

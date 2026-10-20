/**
 * Client-side restaurant + dish search for the homepage hero.
 *
 * Phase 1 of the agreed plan (REMEDIATION_PLAN §2.6): the homepage already
 * loads listed restaurants with their menus, so filtering in the browser needs
 * no backend change. Swap for Postgres full-text search only if search volume
 * (see the `hero_search_select` analytics event) justifies it.
 */

export const MIN_QUERY_LENGTH = 2;

export type SearchableMenuItem = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
};

export type SearchableRestaurant<M extends SearchableMenuItem = SearchableMenuItem> = {
  id: number;
  name: string;
  cuisine?: string | null;
  menu: M[];
};

export type SearchResults<R extends SearchableRestaurant> = {
  restaurants: R[];
  dishes: Array<{ restaurant: R; item: R["menu"][number] }>;
  total: number;
};

/** Lowercase, strip accents (e.g. "Café" → "cafe"), collapse whitespace. */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

function tokenize(query: string): string[] {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

/** Every token must appear somewhere in the haystack ("pap wors" ⇒ both). */
function matchesAll(tokens: string[], haystack: string): boolean {
  return tokens.every((token) => haystack.includes(token));
}

/** 0 = name starts with the query, 1 = a word in the name starts with it, 2 = elsewhere. */
function rank(name: string, query: string): number {
  const normalizedName = normalizeSearchText(name);
  if (normalizedName.startsWith(query)) return 0;
  if (normalizedName.split(" ").some((word) => word.startsWith(query.split(" ")[0]))) return 1;
  return 2;
}

export function searchCatalog<R extends SearchableRestaurant>(
  restaurants: R[],
  rawQuery: string,
  { limit = 5 }: { limit?: number } = {},
): SearchResults<R> {
  const query = normalizeSearchText(rawQuery);
  const tokens = tokenize(rawQuery);
  if (query.length < MIN_QUERY_LENGTH || tokens.length === 0) {
    return { restaurants: [], dishes: [], total: 0 };
  }

  const restaurantMatches = restaurants
    .filter((restaurant) =>
      matchesAll(tokens, normalizeSearchText(`${restaurant.name} ${restaurant.cuisine ?? ""}`)),
    )
    .map((restaurant, index) => ({ restaurant, score: rank(restaurant.name, query), index }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ restaurant }) => restaurant);

  const dishMatches = restaurants
    .flatMap((restaurant) =>
      restaurant.menu
        .filter((item) =>
          matchesAll(
            tokens,
            normalizeSearchText(`${item.name} ${item.category ?? ""} ${item.description ?? ""}`),
          ),
        )
        .map((item) => ({ restaurant, item: item as R["menu"][number] })),
    )
    .map((match, index) => ({ match, score: rank(match.item.name, query), index }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ match }) => match);

  return {
    restaurants: restaurantMatches.slice(0, limit),
    dishes: dishMatches.slice(0, limit),
    total: restaurantMatches.length + dishMatches.length,
  };
}

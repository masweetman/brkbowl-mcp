import Fuse from "fuse.js";
import type { CatalogIndex, IndexedProduct } from "../homesome/catalog.js";
import type { ProducePreference } from "../homesome/types.js";
import { expandQuery, queryTokens } from "./text.js";

export interface SearchOptions {
  limit?: number;
  inStockOnly?: boolean;
  preference: ProducePreference;
}

export interface Scored {
  product: IndexedProduct;
  score: number;
  /** True for produce whose organic status is the opposite of the user's preference. */
  preferenceMismatch: boolean;
  fuzzy: boolean;
}

const PRODUCE = "Produce";
const FLAG_ORGANIC = new Set(["organic"]);
const FLAG_CONVENTIONAL = new Set(["conventional", "nonorganic"]);

const fuseCache = new WeakMap<CatalogIndex, Fuse<IndexedProduct>>();

function fuseFor(index: CatalogIndex): Fuse<IndexedProduct> {
  let fuse = fuseCache.get(index);
  if (!fuse) {
    fuse = new Fuse(index.products, {
      keys: ["name"],
      threshold: 0.3,
      ignoreLocation: true,
      includeScore: true,
    });
    fuseCache.set(index, fuse);
  }
  return fuse;
}

/** Weight of a query token against a product: exact word 1, word prefix 0.7, otherwise 0. */
function tokenWeight(token: string, product: IndexedProduct): number {
  if (product.tokenSet.has(token)) return 1;
  if (token.length >= 3 && product.tokens.some((t) => t.startsWith(token))) return 0.7;
  return 0;
}

function scoreVariant(tokens: string[], product: IndexedProduct): number | null {
  let total = 0;
  for (const token of tokens) {
    const weight = tokenWeight(token, product);
    if (weight === 0) return null;
    total += weight;
  }
  const coverage = total / tokens.length;
  const matched = new Set(tokens);
  const extra = product.words.filter((t) => !matched.has(t)).length;
  let score = coverage * 100 + (extra === 0 ? 20 : -Math.min(extra * 2.5, 30));
  if (tokens.every((t) => product.subTokens.includes(t))) score += 8;
  // Generic produce names ("Loose Carrots") beat prepared foods that merely mention the word.
  if (product.category === PRODUCE && extra <= 1 && tokens.length <= 2) score += 6;
  // English puts the thing itself last: "Large Eggs" is eggs, "Egg Whites" is not.
  if (matched.has(product.words[product.words.length - 1] ?? "")) score += 5;
  return score;
}

export function searchProducts(
  index: CatalogIndex,
  query: string,
  options: SearchOptions,
): Scored[] {
  const allTokens = queryTokens(query);
  const wantsOrganic = allTokens.some((t) => FLAG_ORGANIC.has(t));
  const wantsConventional = allTokens.some((t) => FLAG_CONVENTIONAL.has(t));
  const tokens = allTokens.filter((t) => !FLAG_ORGANIC.has(t) && !FLAG_CONVENTIONAL.has(t));
  if (tokens.length === 0) return [];

  const variants = expandQuery(tokens);
  const inStockOnly = options.inStockOnly ?? true;
  const limit = options.limit ?? 10;
  const results: Scored[] = [];

  const adjust = (product: IndexedProduct, base: number, fuzzy: boolean): Scored | null => {
    if (inStockOnly && !product.inStock) return null;
    let score = base - (product.inStock ? 0 : 50);
    let preferenceMismatch = false;
    if (wantsOrganic || wantsConventional) {
      score += product.organic === wantsOrganic ? 30 : -30;
    } else if (product.category === PRODUCE) {
      preferenceMismatch = product.organic !== (options.preference === "organic");
      if (preferenceMismatch) score -= 20;
    }
    return { product, score, preferenceMismatch, fuzzy };
  };

  for (const product of index.products) {
    let best: number | null = null;
    for (const variant of variants) {
      const s = scoreVariant(variant, product);
      if (s !== null && (best === null || s > best)) best = s;
    }
    if (best === null) continue;
    const scored = adjust(product, best, false);
    if (scored) results.push(scored);
  }

  if (results.length === 0) {
    // Nothing contains every word: fall back to fuzzy matching for typos and odd spellings.
    for (const hit of fuseFor(index).search(tokens.join(" "), { limit: limit * 3 })) {
      const scored = adjust(hit.item, 50 * (1 - (hit.score ?? 1)), true);
      if (scored) results.push(scored);
    }
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.product.tokens.length - b.product.tokens.length ||
      a.product.price - b.product.price,
  );
  // The catalog sometimes lists the same product under several IDs; show it once.
  const seen = new Set<string>();
  const unique = results.filter(({ product: p }) => {
    const key = `${p.name.toLowerCase()}|${p.unit}|${p.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, limit);
}

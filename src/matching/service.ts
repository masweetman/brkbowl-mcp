import type { MatchStore } from "../db/matches.js";
import type { CatalogService, IndexedProduct } from "../homesome/catalog.js";
import type { ProducePreference, StoreRef } from "../homesome/types.js";
import { matchKey, parseListItem, parseQuantityPhrase, type ParsedItem } from "./normalize.js";
import { suggestQuantity, type QuantitySuggestion } from "./quantity.js";
import { searchProducts, type Scored } from "./search.js";
import { tokenize } from "./text.js";

export interface ListItemInput {
  text: string;
  quantity?: number | string;
  unit?: string;
  note?: string;
}

export interface Candidate {
  productId: string;
  name: string;
  price: number;
  unit: string;
  organic: boolean;
  inStock: boolean;
  score: number;
  preferenceMismatch: boolean;
  suggestedCartQuantity: number;
  quantityNote?: string;
  quantityNeedsUserChoice: boolean;
}

export type MatchStatus = "remembered" | "suggested" | "needsUserChoice" | "noMatch";

export interface MatchResult {
  text: string;
  status: MatchStatus;
  key: string;
  parsed: { name: string; quantity?: number; unit?: string; organic?: boolean; note?: string };
  candidates: Candidate[];
  rememberedStale?: boolean;
  reason?: string;
}

const toCandidate = (s: Scored, q: QuantitySuggestion): Candidate => ({
  productId: s.product.id,
  name: s.product.name,
  price: s.product.price,
  unit: s.product.unit,
  organic: s.product.organic,
  inStock: s.product.inStock,
  score: Math.round(s.score * 10) / 10,
  preferenceMismatch: s.preferenceMismatch,
  suggestedCartQuantity: q.quantity,
  quantityNote: q.note,
  quantityNeedsUserChoice: q.needsUserChoice,
});

/** An explicit quantity or unit on the input wins over whatever the text itself says. */
export function parseInput(input: ListItemInput): ParsedItem {
  const parsed = parseListItem(input.text);
  if (input.quantity !== undefined && input.quantity !== "") {
    const phrase = parseQuantityPhrase(`${input.quantity} ${input.unit ?? ""}`.trim());
    if (phrase.quantity !== undefined) {
      parsed.quantity = phrase.quantity;
      parsed.unit = phrase.unit ?? parsed.unit;
    }
  }
  if (input.note) parsed.note = [parsed.note, input.note].filter(Boolean).join("; ");
  return parsed;
}

export class MatchingService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly matches: MatchStore,
  ) {}

  async match(
    store: StoreRef,
    inputs: ListItemInput[],
    preference: ProducePreference,
  ): Promise<MatchResult[]> {
    const index = await this.catalog.get(store);
    return inputs.map((input) => {
      const parsed = parseInput(input);
      const key = matchKey(parsed, tokenize);
      const base = {
        text: input.text,
        key,
        parsed: {
          name: parsed.name,
          quantity: parsed.quantity,
          unit: parsed.unit,
          organic: parsed.organic,
          note: parsed.note,
        },
      };
      if (!parsed.name) {
        return {
          ...base,
          status: "noMatch" as const,
          candidates: [],
          reason: "The item text is empty.",
        };
      }

      let rememberedStale = false;
      const remembered = this.matches.get(store.key, key);
      if (remembered) {
        const product = index.byId.get(remembered.productId);
        if (product?.inStock) {
          this.matches.touch(store.key, key);
          const q = suggestQuantity(product, {
            quantity: parsed.quantity,
            unit: parsed.unit,
            defaultQuantity: remembered.defaultQuantity ?? undefined,
          });
          return {
            ...base,
            status: "remembered" as const,
            candidates: [
              toCandidate({ product, score: 999, preferenceMismatch: false, fuzzy: false }, q),
            ],
          };
        }
        rememberedStale = true;
      }

      const query =
        parsed.organic === undefined
          ? parsed.name
          : `${parsed.organic ? "organic" : "conventional"} ${parsed.name}`;
      const found = searchProducts(index, query, { limit: 5, preference });
      const candidates = found.map((s) =>
        toCandidate(
          s,
          suggestQuantity(s.product, { quantity: parsed.quantity, unit: parsed.unit }),
        ),
      );
      const stale = rememberedStale ? { rememberedStale: true } : {};
      if (found.length === 0) {
        return {
          ...base,
          ...stale,
          status: "noMatch" as const,
          candidates,
          reason: "Nothing in the catalog matches.",
        };
      }
      return { ...base, ...stale, ...this.judge(found, candidates) };
    });
  }

  private judge(found: Scored[], candidates: Candidate[]) {
    const top = found[0]!;
    const second = found[1];
    const exactish = top.score >= 105;
    const clearLead = !second || top.score - second.score >= 8;
    const confident =
      !top.fuzzy &&
      exactish &&
      clearLead &&
      !top.preferenceMismatch &&
      !candidates[0]!.quantityNeedsUserChoice;
    if (confident) return { status: "suggested" as const, candidates };
    const reason = top.fuzzy
      ? "Only approximate matches were found."
      : top.preferenceMismatch
        ? "The best match does not fit the organic/conventional preference."
        : candidates[0]!.quantityNeedsUserChoice
          ? "The quantity could not be converted reliably."
          : "Several products fit; ask the user which one they usually buy.";
    return { status: "needsUserChoice" as const, candidates, reason };
  }
}

export type { IndexedProduct };

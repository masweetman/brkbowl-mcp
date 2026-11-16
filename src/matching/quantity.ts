import type { Product } from "../homesome/types.js";
import { isWeightUnit, toPounds } from "./normalize.js";

export interface QuantityRequest {
  quantity?: number;
  unit?: string;
  /** Quantity remembered from an earlier confirmed match. */
  defaultQuantity?: number;
}

export interface QuantitySuggestion {
  quantity: number;
  note?: string;
  /** True when converting the list quantity to this product is a guess the user should confirm. */
  needsUserChoice: boolean;
}

const DOZEN_NAME = /\b(dozen|12\s*(?:ct|count|pack))\b/i;
const GUESS_LB_PER_PIECE = 0.5;

/** The smallest allowed change in cart quantity. */
export function stepFor(product: Product): number {
  if (product.unit === "lb" && !product.sellByQty) return product.unitIncrement || 0.5;
  return 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function roundUpToStep(quantity: number, step: number): number {
  return round2(Math.ceil(quantity / step - 1e-9) * step);
}

/** Rounds up to the product's step, then applies the product's own min and max if it has them. */
export function normalizeCartQuantity(
  product: Product,
  quantity: number,
): { quantity: number; note?: string } {
  const step = stepFor(product);
  let q = Math.max(step, roundUpToStep(quantity, step));
  let note: string | undefined;
  if (product.minQuantity > 0 && q < product.minQuantity) {
    q = product.minQuantity;
    note = `Raised to the minimum of ${q}.`;
  }
  if (product.maxQuantity > 0 && q > product.maxQuantity) {
    q = product.maxQuantity;
    note = `Limited to the maximum of ${q}.`;
  }
  return { quantity: q, note };
}

function describe(quantity: number, unit: string | undefined): string {
  return `${quantity}${unit ? ` ${unit}` : ""}`;
}

/** Converts what the shopping list asks for into a cart quantity for this product. */
export function suggestQuantity(product: Product, request: QuantityRequest): QuantitySuggestion {
  const { quantity, unit } = request;
  const wrap = (raw: number, note?: string, needsUserChoice = false): QuantitySuggestion => {
    const normalized = normalizeCartQuantity(product, raw);
    return {
      quantity: normalized.quantity,
      note: [note, normalized.note].filter(Boolean).join(" ") || undefined,
      needsUserChoice,
    };
  };

  if (quantity === undefined) {
    return wrap(
      request.defaultQuantity ?? 1,
      request.defaultQuantity ? undefined : "No quantity on the list; using the minimum.",
    );
  }

  const weighted = isWeightUnit(unit);
  const dozen = unit === "dozen";
  const lb = weighted ? toPounds(quantity, unit!) : undefined;
  const asked = describe(quantity, unit);

  if (product.unit === "lb" && product.sellByQty) {
    // Sold by the piece, priced per pound.
    if (lb !== undefined) {
      if (product.avgWeight && product.avgWeight > 0) {
        const pieces = Math.ceil(lb / product.avgWeight - 1e-9);
        return wrap(
          pieces,
          `${asked} is about ${pieces} pieces (average ${product.avgWeight} lb each).`,
        );
      }
      return wrap(Math.round(lb), `Sold by the piece; could not convert ${asked}.`, true);
    }
    return wrap(dozen ? quantity * 12 : quantity);
  }

  if (product.unit === "lb") {
    // Sold by weight.
    if (lb !== undefined) return wrap(lb);
    if (dozen) return wrap(stepFor(product), `Sold by weight; could not convert ${asked}.`, true);
    if (product.avgWeight && product.avgWeight > 0) {
      return wrap(
        quantity * product.avgWeight,
        `${asked} is about ${round2(quantity * product.avgWeight)} lb.`,
      );
    }
    return wrap(
      quantity * GUESS_LB_PER_PIECE,
      `Sold by weight; guessing ${GUESS_LB_PER_PIECE} lb per piece for ${asked}.`,
      true,
    );
  }

  // Sold by the package or each.
  if (lb !== undefined) {
    return wrap(1, `The list asks for ${asked}; this product is sold per package.`, true);
  }
  if (dozen) {
    return DOZEN_NAME.test(product.name)
      ? wrap(quantity)
      : wrap(quantity * 12, `${asked} is ${quantity * 12} items.`, true);
  }
  return wrap(quantity);
}

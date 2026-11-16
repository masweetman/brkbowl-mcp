import { describe, expect, it } from "vitest";
import type { Product } from "../src/homesome/types.js";
import {
  normalizeCartQuantity,
  roundUpToStep,
  stepFor,
  suggestQuantity,
} from "../src/matching/quantity.js";

const base: Product = {
  id: "x",
  name: "Thing",
  category: "Produce",
  subType: "",
  price: 1,
  unit: "count",
  unitIncrement: null,
  sellByQty: false,
  avgWeight: null,
  organic: false,
  inStock: true,
  minQuantity: 0,
  maxQuantity: 0,
  brand: "",
  upc: "",
};
const each = base;
const perPiece: Product = { ...base, name: "Bananas", unit: "lb", sellByQty: true, avgWeight: 0.4 };
const byWeight: Product = { ...base, name: "Fingerling Potatoes", unit: "lb" };
const byWeightStep: Product = { ...byWeight, unitIncrement: 0.25 };

describe("steps and rounding", () => {
  it("uses the website's 0.5 lb default for loose weight items", () => {
    expect(stepFor(byWeight)).toBe(0.5);
    expect(stepFor(byWeightStep)).toBe(0.25);
    expect(stepFor(perPiece)).toBe(1);
    expect(stepFor(each)).toBe(1);
  });
  it("rounds up, without floating point noise", () => {
    expect(roundUpToStep(1.1, 0.5)).toBe(1.5);
    expect(roundUpToStep(0.3, 0.1)).toBe(0.3);
    expect(roundUpToStep(2, 0.5)).toBe(2);
  });
  it("enforces product min and max", () => {
    expect(normalizeCartQuantity({ ...each, minQuantity: 3 }, 1).quantity).toBe(3);
    expect(normalizeCartQuantity({ ...each, maxQuantity: 4 }, 9).quantity).toBe(4);
  });
});

describe("suggestQuantity", () => {
  it("counts for packaged items", () => {
    expect(suggestQuantity(each, { quantity: 3 })).toMatchObject({
      quantity: 3,
      needsUserChoice: false,
    });
  });
  it("uses the remembered default when the list has no quantity", () => {
    expect(suggestQuantity(each, { defaultQuantity: 2 }).quantity).toBe(2);
    expect(suggestQuantity(each, {}).quantity).toBe(1);
  });
  it("converts pounds to pieces for per-piece produce", () => {
    // 2 lb of 0.4 lb bananas -> 5 pieces
    expect(suggestQuantity(perPiece, { quantity: 2, unit: "lb" })).toMatchObject({
      quantity: 5,
      needsUserChoice: false,
    });
  });
  it("keeps counts as pieces for per-piece produce", () => {
    expect(suggestQuantity(perPiece, { quantity: 6 }).quantity).toBe(6);
  });
  it("rounds weight items up to the step", () => {
    expect(suggestQuantity(byWeight, { quantity: 1.2, unit: "lb" }).quantity).toBe(1.5);
    expect(suggestQuantity(byWeight, { quantity: 8, unit: "oz" }).quantity).toBe(0.5);
  });
  it("flags guesses when a count is requested for a by-weight item", () => {
    expect(suggestQuantity(byWeight, { quantity: 3 })).toMatchObject({
      quantity: 1.5,
      needsUserChoice: true,
    });
    expect(suggestQuantity({ ...byWeight, avgWeight: 0.5 }, { quantity: 3 })).toMatchObject({
      quantity: 1.5,
      needsUserChoice: false,
    });
  });
  it("flags weights requested for packaged items", () => {
    expect(suggestQuantity(each, { quantity: 2, unit: "lb" })).toMatchObject({
      quantity: 1,
      needsUserChoice: true,
    });
  });
  it("converts dozens unless the product is already a dozen", () => {
    expect(suggestQuantity(each, { quantity: 1, unit: "dozen" })).toMatchObject({
      quantity: 12,
      needsUserChoice: true,
    });
    expect(
      suggestQuantity({ ...each, name: "Large Eggs, 1 Dozen" }, { quantity: 2, unit: "dozen" })
        .quantity,
    ).toBe(2);
  });
});

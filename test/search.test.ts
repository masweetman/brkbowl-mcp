import { describe, expect, it } from "vitest";
import { buildIndex, slimProduct } from "../src/homesome/catalog.js";
import type { Product } from "../src/homesome/types.js";
import { searchProducts } from "../src/matching/search.js";
import { expandQuery, tokenize } from "../src/matching/text.js";
import { FakeHomesome } from "./helpers.js";

const raw = new FakeHomesome().catalog;
const index = buildIndex(
  raw.map((r) => slimProduct(r)).filter((p): p is Product => p !== null),
  "now",
);
const names = (q: string, preference: "conventional" | "organic" = "conventional", limit = 5) =>
  searchProducts(index, q, { preference, limit }).map((r) => r.product.name);

describe("tokenize", () => {
  it("singularizes and strips accents", () => {
    expect(tokenize("Niño Bananas")).toEqual(["nino", "banana"]);
    expect(tokenize("tomatoes")).toEqual(["tomato"]);
    expect(tokenize("berries")).toEqual(["berry"]);
    expect(tokenize("hummus")).toEqual(["hummus"]);
  });
  it("expands synonyms", () => {
    expect(expandQuery(tokenize("scallion")).map((v) => v.join(" "))).toContain("green onion");
  });
});

describe("slimProduct", () => {
  it("treats 'organic' in the name as organic even if the flag is missing", () => {
    expect(slimProduct({ name: "a", displayName: "Organic Kale", organic: false })?.organic).toBe(
      true,
    );
  });
  it("drops entries without an id or name", () => {
    expect(slimProduct({ displayName: "No id" })).toBeNull();
  });
  it("reads numeric strings", () => {
    expect(slimProduct({ name: "a", displayName: "A", unitIncrement: "0.25" })?.unitIncrement).toBe(
      0.25,
    );
  });
});

describe("searchProducts", () => {
  it("finds plain produce by name", () => {
    expect(names("avocado")[0]).toMatch(/avocado/i);
  });

  it("prefers conventional produce by default and organic when asked", () => {
    const conventional = searchProducts(index, "avocados", {
      preference: "conventional",
      limit: 3,
    });
    expect(conventional[0]!.product.organic).toBe(false);
    expect(conventional[0]!.preferenceMismatch).toBe(false);

    const organic = searchProducts(index, "avocados", { preference: "organic", limit: 3 });
    expect(organic[0]!.product.organic).toBe(true);
  });

  it("flags produce that goes against the preference", () => {
    const results = searchProducts(index, "lemons", { preference: "conventional", limit: 10 });
    const organicLemon = results.find((r) => r.product.organic);
    expect(organicLemon?.preferenceMismatch).toBe(true);
  });

  it("lets the words in the query override the preference", () => {
    expect(
      searchProducts(index, "organic bananas", { preference: "conventional", limit: 1 })[0]!.product
        .organic,
    ).toBe(true);
    expect(
      searchProducts(index, "conventional bananas", { preference: "organic", limit: 1 })[0]!.product
        .organic,
    ).toBe(false);
  });

  it("matches singular and plural forms", () => {
    expect(names("carrot").length).toBeGreaterThan(0);
    expect(names("carrots")[0]).toBe(names("carrot")[0]);
  });

  it("requires every word to match, and falls back to fuzzy matching for typos", () => {
    const exact = searchProducts(index, "banana", { preference: "conventional" });
    expect(exact.every((r) => !r.fuzzy)).toBe(true);
    const typo = searchProducts(index, "avacado", { preference: "conventional" });
    expect(typo.length).toBeGreaterThan(0);
    expect(typo.every((r) => r.fuzzy)).toBe(true);
  });

  it("returns nothing for gibberish and for flag-only queries", () => {
    expect(names("zzzxqv")).toEqual([]);
    expect(names("organic")).toEqual([]);
  });

  it("hides out-of-stock products unless asked", () => {
    const soldOut = buildIndex(
      [{ ...slimProduct({ name: "k", displayName: "Kale", type: "Produce" })!, inStock: false }],
      "now",
    );
    expect(searchProducts(soldOut, "kale", { preference: "conventional" })).toHaveLength(0);
    expect(
      searchProducts(soldOut, "kale", { preference: "conventional", inStockOnly: false }),
    ).toHaveLength(1);
  });

  it("only applies the produce preference to produce", () => {
    const milk = searchProducts(index, "milk", { preference: "conventional", limit: 20 });
    expect(milk.some((r) => r.preferenceMismatch)).toBe(false);
  });

  describe("on a small synthetic catalog", () => {
    const make = (id: string, name: string, extra: Partial<Product> = {}): Product => ({
      ...slimProduct({ name: id, displayName: name, type: "Dairy & Eggs", price: 3 })!,
      ...extra,
    });
    const tiny = (...p: Product[]) => buildIndex(p, "now");
    const top = (i: ReturnType<typeof tiny>, q: string) =>
      searchProducts(i, q, { preference: "conventional" }).map((r) => r.product.name);

    it("ranks the thing itself above products that merely contain the word", () => {
      const i = tiny(make("a", "Nulaid Egg Whites 32oz"), make("b", "Large Eggs 12 ct"));
      expect(top(i, "eggs")[0]).toBe("Large Eggs 12 ct");
    });

    it("ignores sizes when judging how generic a name is", () => {
      const i = tiny(make("a", "Whole Milk 64 oz 1/2 gal"), make("b", "Brand Chocolate Milk"));
      expect(top(i, "milk")[0]).toBe("Whole Milk 64 oz 1/2 gal");
    });

    it("shows a product listed under several IDs only once", () => {
      const i = tiny(make("a", "Olive Oil 32 oz"), make("b", "Olive Oil 32 oz"));
      expect(top(i, "olive oil")).toEqual(["Olive Oil 32 oz"]);
    });
  });
});

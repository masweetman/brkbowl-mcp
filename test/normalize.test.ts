import { describe, expect, it } from "vitest";
import { matchKey, parseListItem, parseQuantityPhrase } from "../src/matching/normalize.js";
import { tokenize } from "../src/matching/text.js";

describe("parseListItem", () => {
  it.each([
    ["2 lbs organic carrots", { name: "carrots", quantity: 2, unit: "lb", organic: true }],
    ["1.5 lb tomatoes", { name: "tomatoes", quantity: 1.5, unit: "lb", organic: undefined }],
    ["3 bunches cilantro", { name: "cilantro", quantity: 3, unit: "bunch" }],
    ["1 dozen eggs", { name: "eggs", quantity: 1, unit: "dozen" }],
    ["milk", { name: "milk", quantity: undefined, unit: undefined }],
    ["4 avocados", { name: "avocados", quantity: 4, unit: undefined }],
    ["1 1/2 lb ginger", { name: "ginger", quantity: 1.5, unit: "lb" }],
    ["½ lb butter", { name: "butter", quantity: 0.5, unit: "lb" }],
    ["bunch of cilantro", { name: "bunch of cilantro" }],
    ["2 bunches of kale", { name: "kale", quantity: 2, unit: "bunch" }],
    ["carrots, 2 lb", { name: "carrots", quantity: 2, unit: "lb" }],
    ["onions (3)", { name: "onions", quantity: 3 }],
    ["conventional bananas", { name: "bananas", organic: false }],
    ["2lb carrots", { name: "carrots", quantity: 2, unit: "lb" }],
  ])("%s", (text, expected) => {
    expect(parseListItem(text)).toMatchObject(expected);
  });

  it("keeps non-quantity parentheticals as a note", () => {
    expect(parseListItem("milk (whole, for kids)")).toMatchObject({
      name: "milk",
      note: "whole, for kids",
    });
  });

  it("does not treat a number inside a name as a quantity", () => {
    expect(parseListItem("7up")).toMatchObject({ name: "7up" });
  });
});

describe("parseQuantityPhrase", () => {
  it("reads numbers, units and fractions", () => {
    expect(parseQuantityPhrase("2")).toEqual({ quantity: 2, unit: undefined });
    expect(parseQuantityPhrase("1.5 lb")).toEqual({ quantity: 1.5, unit: "lb" });
    expect(parseQuantityPhrase("12 oz")).toEqual({ quantity: 12, unit: "oz" });
  });
  it("returns nothing for non-quantities", () => {
    expect(parseQuantityPhrase("some")).toEqual({});
  });
});

describe("matchKey", () => {
  const key = (text: string) => matchKey(parseListItem(text), tokenize);
  it("ignores case, plurals and quantities", () => {
    expect(key("2 Tomatoes")).toBe(key("tomato"));
    expect(key("Berries")).toBe(key("berry"));
  });
  it("keeps organic items separate", () => {
    expect(key("organic milk")).not.toBe(key("milk"));
  });
});

import { describe, expect, it } from "vitest";
import { MAX_LINE_QUANTITY } from "../src/homesome/basket.js";
import { loginTestSession, testContext } from "./helpers.js";

async function setup() {
  const { ctx, fake } = testContext();
  loginTestSession(ctx);
  const store = await ctx.stores.resolve();
  const id = (predicate: Parameters<typeof fake.product>[0]) =>
    String(fake.product(predicate).name);
  return { ctx, fake, store, id };
}

describe("cart", () => {
  it("resolves the default store and exposes the online price list", async () => {
    const { store } = await setup();
    expect(store).toMatchObject({ key: "west", name: "Berkeley Bowl West" });
  });

  it("ADDS to the existing quantity even though the API replaces it", async () => {
    const { ctx, fake, store, id } = await setup();
    const avocado = id(
      (p) => p.type === "Produce" && /avocado/i.test(String(p.displayName)) && p.unit === "count",
    );

    await ctx.basket.add(store, [{ productId: avocado, quantity: 2 }]);
    const second = await ctx.basket.add(store, [{ productId: avocado, quantity: 3 }]);

    expect(second[0]).toMatchObject({ status: "ok", previousQuantity: 2, newQuantity: 5 });
    expect(fake.cart.get(avocado)?.quantity).toBe(5);
  });

  it("sends several items in one request and reports each one", async () => {
    const { ctx, fake, store, id } = await setup();
    const a = id((p) => /avocado/i.test(String(p.displayName)));
    const b = id((p) => /lemon/i.test(String(p.displayName)));
    const before = fake.calls.filter(
      (c) => c.method === "POST" && c.path === "/user/basket",
    ).length;

    const results = await ctx.basket.add(store, [
      { productId: a, quantity: 1 },
      { productId: b, quantity: 2 },
      { productId: "does-not-exist", quantity: 1 },
    ]);

    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "error"]);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/user/basket")).toHaveLength(
      before + 1,
    );
    expect(fake.cart.size).toBe(2);
  });

  it("combines repeated lines for the same product in one batch", async () => {
    const { ctx, fake, store, id } = await setup();
    const a = id((p) => /avocado/i.test(String(p.displayName)) && p.unit === "count");
    const results = await ctx.basket.add(store, [
      { productId: a, quantity: 1 },
      { productId: a, quantity: 2 },
    ]);
    expect(results[1]).toMatchObject({ previousQuantity: 1, newQuantity: 3 });
    expect(fake.cart.get(a)?.quantity).toBe(3);
  });

  it("rounds weight items up to their step", async () => {
    const { ctx, fake, store, id } = await setup();
    const loose = id((p) => p.unit === "lb" && p.sellByQty !== true);
    const results = await ctx.basket.add(store, [{ productId: loose, quantity: 1.1 }]);
    expect(results[0]!.newQuantity).toBe(1.5);
    expect(fake.cart.get(loose)?.quantity).toBe(1.5);
  });

  it("refuses absurd quantities", async () => {
    const { ctx, fake, store, id } = await setup();
    const a = id((p) => /avocado/i.test(String(p.displayName)) && p.unit === "count");
    const [result] = await ctx.basket.add(store, [
      { productId: a, quantity: MAX_LINE_QUANTITY + 1 },
    ]);
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("safety limit"),
    });
    expect(fake.cart.size).toBe(0);
  });

  it("refuses out-of-stock products", async () => {
    const { ctx, fake, store, id } = await setup();
    const a = id((p) => /avocado/i.test(String(p.displayName)) && p.unit === "count");
    fake.catalog.find((p) => p.name === a)!.isInStock = false;
    await ctx.catalog.refresh(store);
    const [result] = await ctx.basket.add(store, [{ productId: a, quantity: 1 }]);
    expect(result).toMatchObject({ status: "error", error: "Out of stock." });
  });

  it("sets, reads back, and removes", async () => {
    const { ctx, fake, store, id } = await setup();
    const a = id((p) => /avocado/i.test(String(p.displayName)) && p.unit === "count");
    await ctx.basket.add(store, [{ productId: a, quantity: 2 }]);

    await ctx.basket.setQuantity(store, a, 4);
    const cart = await ctx.basket.get(store);
    expect(cart.items[0]).toMatchObject({ productId: a, quantity: 4 });
    expect(cart.total).toBeGreaterThan(0);

    await ctx.basket.setQuantity(store, a, 0);
    expect(fake.cart.size).toBe(0);
  });

  it("clears the whole cart", async () => {
    const { ctx, fake, store, id } = await setup();
    await ctx.basket.add(store, [
      { productId: id((p) => /avocado/i.test(String(p.displayName))), quantity: 1 },
      { productId: id((p) => /lemon/i.test(String(p.displayName))), quantity: 1 },
    ]);
    expect(await ctx.basket.clear(store)).toBe(2);
    expect(fake.cart.size).toBe(0);
  });

  it("passes cart errors through as AUTH_REQUIRED when logged out", async () => {
    const { ctx, store } = await setup();
    ctx.session.clear();
    await expect(ctx.basket.get(store)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("forgets the session when the server says it expired", async () => {
    const { ctx, fake, store } = await setup();
    fake.sessionValid = false;
    await expect(ctx.basket.get(store)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(ctx.session.load()).toBeNull();
  });
});

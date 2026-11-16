import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { guard, ok, storeField } from "./util.js";

export function registerCartTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_cart",
    {
      title: "Get cart",
      description:
        "Show the current Berkeley Bowl cart for a store, with estimated prices. Requires login. " +
        "Prices for items sold by weight are estimates.",
      inputSchema: { store: storeField },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ store }) => {
      const s = await ctx.stores.resolve(store);
      const cart = await ctx.basket.get(s);
      return ok(
        `${cart.items.length} item(s) in the ${s.key} cart, estimated total $${cart.total.toFixed(2)}.`,
        cart,
      );
    }),
  );

  server.registerTool(
    "add_to_cart",
    {
      title: "Add items to cart",
      description:
        "Add products to the cart. Quantities are ADDED to what is already in the cart, rounded up to the " +
        "product's step (e.g. 0.5 lb for loose items). Several items can be sent at once; each gets its own " +
        "result. This never checks out; the user places the order on the website. Requires login.",
      inputSchema: {
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              quantity: z
                .number()
                .positive()
                .describe("Amount to add: items, or pounds for items sold by weight."),
              instructions: z
                .string()
                .max(200)
                .optional()
                .describe("Optional note for the shopper, e.g. 'ripe'."),
              allowSubstitute: z.boolean().default(true),
            }),
          )
          .min(1)
          .max(100),
        store: storeField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(async ({ items, store }) => {
      const s = await ctx.stores.resolve(store);
      const results = await ctx.basket.add(s, items);
      const failed = results.filter((r) => r.status === "error").length;
      return ok(
        `${results.length - failed} of ${results.length} item(s) added to the ${s.key} cart.` +
          (failed ? ` ${failed} failed; see the errors.` : ""),
        results,
      );
    }),
  );

  server.registerTool(
    "set_cart_quantity",
    {
      title: "Set cart quantity",
      description:
        "Set the exact quantity of one item in the cart. A quantity of 0 removes it. Requires login.",
      inputSchema: {
        productId: z.string().min(1),
        quantity: z.number().min(0),
        store: storeField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async ({ productId, quantity, store }) => {
      const s = await ctx.stores.resolve(store);
      const result = await ctx.basket.setQuantity(s, productId, quantity);
      return ok(
        result.status === "ok"
          ? `Quantity set to ${result.newQuantity}.`
          : "Could not set the quantity.",
        result,
      );
    }),
  );

  server.registerTool(
    "remove_from_cart",
    {
      title: "Remove from cart",
      description: "Remove one product from the cart. Requires login.",
      inputSchema: { productId: z.string().min(1), store: storeField },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    guard(async ({ productId, store }) => {
      const s = await ctx.stores.resolve(store);
      await ctx.basket.remove(s, productId);
      return ok("Removed from the cart.", { productId });
    }),
  );

  server.registerTool(
    "clear_cart",
    {
      title: "Clear cart",
      description:
        "Remove every item from a store's cart. Only call this when the user asks; requires confirm=true.",
      inputSchema: { confirm: z.literal(true).describe("Must be true."), store: storeField },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    guard(async ({ store }) => {
      const s = await ctx.stores.resolve(store);
      const removed = await ctx.basket.clear(s);
      return ok(`Removed ${removed} item(s) from the ${s.key} cart.`, { removed });
    }),
  );
}

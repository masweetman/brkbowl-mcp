import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";
import { matchKey } from "../matching/normalize.js";
import { parseListItem } from "../matching/normalize.js";
import { tokenize } from "../matching/text.js";
import { guard, ok, preferenceField, storeField } from "./util.js";

const keyFor = (text: string) => matchKey(parseListItem(text), tokenize);

export function registerMatchingTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "match_items",
    {
      title: "Match shopping-list items to products",
      description:
        "Match shopping-list items (for example from AnyList) to Berkeley Bowl products. Each result has a " +
        "status: 'remembered' (the user confirmed this product before), 'suggested' (one clear best match), " +
        "'needsUserChoice' (several fit; show the candidates and ask the user), or 'noMatch'. Candidates " +
        "include a suggested cart quantity converted from the list quantity. After the user picks a product, " +
        "call remember_match so next time it is automatic. Ask the user for store and organic/conventional " +
        "preferences first unless already known.",
      inputSchema: {
        items: z
          .array(
            z.object({
              text: z
                .string()
                .min(1)
                .describe("The item as written, e.g. '2 lb carrots' or 'milk'."),
              quantity: z
                .union([z.number(), z.string()])
                .optional()
                .describe("Quantity if separate from text."),
              unit: z.string().optional().describe("Unit if separate from text, e.g. 'lb'."),
              note: z.string().optional(),
            }),
          )
          .min(1)
          .max(100),
        store: storeField,
        producePreference: preferenceField,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ items, store, producePreference }) => {
      const s = await ctx.stores.resolve(store);
      const preference = producePreference ?? ctx.config.DEFAULT_PRODUCE_PREFERENCE;
      const results = await ctx.matching.match(s, items, preference);
      const counts = { remembered: 0, suggested: 0, needsUserChoice: 0, noMatch: 0 };
      for (const r of results) counts[r.status]++;
      return ok(
        `${results.length} item(s) at ${s.key} (${preference} produce): ${counts.remembered} remembered, ` +
          `${counts.suggested} suggested, ${counts.needsUserChoice} need a choice, ${counts.noMatch} not found.`,
        results,
      );
    }),
  );

  server.registerTool(
    "remember_match",
    {
      title: "Remember a match",
      description:
        "Remember that a shopping-list item should map to a specific product. Call this after the user " +
        "confirms a choice so future lists match automatically.",
      inputSchema: {
        listText: z
          .string()
          .min(1)
          .describe("The list wording, e.g. 'milk' or 'organic carrots'. Quantities are ignored."),
        productId: z.string().min(1),
        defaultQuantity: z
          .number()
          .positive()
          .optional()
          .describe("Cart quantity to use when the list gives none."),
        store: storeField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard(async ({ listText, productId, defaultQuantity, store }) => {
      const s = await ctx.stores.resolve(store);
      const product = await ctx.catalog.getProduct(s, productId);
      if (!product)
        throw new AppError("NOT_FOUND", `No product with ID "${productId}" at ${s.key}.`);
      const key = keyFor(listText);
      if (!key) throw new AppError("INVALID_INPUT", "listText has no usable words.");
      ctx.matches.upsert({
        store: s.key,
        key,
        productId: product.id,
        productName: product.name,
        defaultQuantity: defaultQuantity ?? null,
      });
      return ok(`Remembered "${key}" -> ${product.name} at ${s.key}.`, {
        key,
        productId: product.id,
      });
    }),
  );

  server.registerTool(
    "forget_match",
    {
      title: "Forget a match",
      description: "Delete a remembered list-item-to-product match.",
      inputSchema: { listText: z.string().min(1), store: storeField },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    guard(async ({ listText, store }) => {
      const s = await ctx.stores.resolve(store);
      const removed = ctx.matches.delete(s.key, keyFor(listText));
      return ok(removed ? "Forgotten." : "No remembered match for that text.", { removed });
    }),
  );

  server.registerTool(
    "list_matches",
    {
      title: "List remembered matches",
      description: "List all remembered list-item-to-product matches for a store.",
      inputSchema: { store: storeField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async ({ store }) => {
      const s = await ctx.stores.resolve(store);
      const rows = ctx.matches.list(s.key);
      return ok(`${rows.length} remembered match(es) at ${s.key}.`, rows);
    }),
  );
}

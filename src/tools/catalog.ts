import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";
import type { IndexedProduct } from "../homesome/catalog.js";
import { searchProducts } from "../matching/search.js";
import { guard, ok, preferenceField, storeField } from "./util.js";

export const publicProduct = (p: IndexedProduct) => ({
  productId: p.id,
  name: p.name,
  category: p.category,
  subType: p.subType,
  price: p.price,
  unit: p.unit,
  soldBy: p.unit === "lb" ? (p.sellByQty ? "piece (priced per lb)" : "weight (lb)") : "each",
  step: p.unit === "lb" && !p.sellByQty ? p.unitIncrement || 0.5 : 1,
  avgWeightLb: p.avgWeight,
  organic: p.organic,
  inStock: p.inStock,
  brand: p.brand || undefined,
});

export function registerCatalogTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Search the Berkeley Bowl catalog by name. Results are ranked best first. For produce, results " +
        "follow the organic/conventional preference; items that go against it are flagged preferenceMismatch. " +
        "The first call after a restart may take about a minute while the catalog downloads.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("What to look for, e.g. 'avocado' or 'organic whole milk'."),
        store: storeField,
        producePreference: preferenceField,
        limit: z.number().int().min(1).max(25).default(10),
        inStockOnly: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ query, store, producePreference, limit, inStockOnly }) => {
      const s = await ctx.stores.resolve(store);
      const index = await ctx.catalog.get(s);
      const found = searchProducts(index, query, {
        limit,
        inStockOnly,
        preference: producePreference ?? ctx.config.DEFAULT_PRODUCE_PREFERENCE,
      });
      const data = found.map((f) => ({
        ...publicProduct(f.product),
        score: Math.round(f.score * 10) / 10,
        preferenceMismatch: f.preferenceMismatch,
      }));
      return ok(`${data.length} result(s) for "${query}" at ${s.key}.`, data);
    }),
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: "Get the details of one product by its productId.",
      inputSchema: { productId: z.string().min(1), store: storeField },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ productId, store }) => {
      const s = await ctx.stores.resolve(store);
      const product = await ctx.catalog.getProduct(s, productId);
      if (!product)
        throw new AppError("NOT_FOUND", `No product with ID "${productId}" at ${s.key}.`);
      return ok(product.name, publicProduct(product));
    }),
  );

  server.registerTool(
    "refresh_catalog",
    {
      title: "Refresh catalog",
      description:
        "Download the store's product catalog again now. It refreshes automatically; use this only if " +
        "products seem out of date. Takes up to a minute.",
      inputSchema: { store: storeField },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(async ({ store }) => {
      const s = await ctx.stores.resolve(store);
      const index = await ctx.catalog.refresh(s);
      return ok(`Catalog refreshed for ${s.key}.`, {
        products: index.products.length,
        fetchedAt: index.fetchedAt,
      });
    }),
  );
}

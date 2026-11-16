import type { Db } from "../db/index.js";
import { log } from "../util/log.js";
import { tokenize } from "../matching/text.js";
import { AppError } from "../errors.js";
import type { HomesomeClient } from "./client.js";
import type { Product, StoreRef } from "./types.js";

export interface IndexedProduct extends Product {
  tokens: string[];
  tokenSet: Set<string>;
  /** Tokens that describe the product itself: no sizes, counts or units. */
  words: string[];
  subTokens: string[];
}

export interface CatalogIndex {
  fetchedAt: string;
  products: IndexedProduct[];
  byId: Map<string, IndexedProduct>;
}

type Raw = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Reduces a raw catalog entry to the fields we use. Returns null if it has no usable ID or name. */
export function slimProduct(raw: Raw): Product | null {
  const id = str(raw.name);
  const name = str(raw.displayName);
  if (!id || !name) return null;
  return {
    id,
    name,
    category: str(raw.type),
    subType: str(raw.subType),
    price: num(raw.price) ?? 0,
    unit: str(raw.unit) || "count",
    unitIncrement: num(raw.unitIncrement),
    sellByQty: raw.sellByQty === true,
    avgWeight: num(raw.avgWeight),
    organic: raw.organic === true || /\borganic\b/i.test(name),
    inStock: raw.isInStock !== false && raw.availableToOrder !== false,
    minQuantity: num(raw.minQuantity) ?? 0,
    maxQuantity: num(raw.maxQuantity) ?? 0,
    brand: str(raw.brand),
    upc: str(raw.upc),
  };
}

const SIZE_WORDS = new Set([
  "oz",
  "lb",
  "gr",
  "g",
  "kg",
  "ml",
  "l",
  "fl",
  "ct",
  "count",
  "pack",
  "pk",
  "each",
  "ea",
  "gal",
  "gallon",
  "qt",
  "quart",
  "pt",
  "pint",
  "liter",
  "per",
  "size",
  "approx",
]);
const isSizeToken = (t: string) => /^\d/.test(t) || SIZE_WORDS.has(t);

export function buildIndex(products: Product[], fetchedAt: string): CatalogIndex {
  const indexed = products.map<IndexedProduct>((p) => {
    const tokens = tokenize(p.name);
    return {
      ...p,
      tokens,
      tokenSet: new Set(tokens),
      words: tokens.filter((t) => !isSizeToken(t)),
      subTokens: tokenize(p.subType),
    };
  });
  return { fetchedAt, products: indexed, byId: new Map(indexed.map((p) => [p.id, p])) };
}

export class CatalogService {
  private readonly memory = new Map<string, CatalogIndex>();
  private readonly inflight = new Map<string, Promise<CatalogIndex>>();

  constructor(
    private readonly client: HomesomeClient,
    private readonly db: Db,
    private readonly ttlHours: number,
  ) {}

  private isFresh(fetchedAt: string): boolean {
    return Date.now() - Date.parse(fetchedAt) < this.ttlHours * 3_600_000;
  }

  private loadFromDb(store: StoreRef): CatalogIndex | undefined {
    const row = this.db
      .prepare("SELECT fetched_at, payload_json FROM catalog_cache WHERE store = ?")
      .get(store.key) as { fetched_at: string; payload_json: string } | undefined;
    if (!row) return undefined;
    try {
      return buildIndex(JSON.parse(row.payload_json) as Product[], row.fetched_at);
    } catch {
      return undefined;
    }
  }

  private async download(store: StoreRef): Promise<CatalogIndex> {
    log.info("Downloading catalog", { store: store.key });
    const body = await this.client.request<{ products?: Raw[] }>("/product/list?listType=ui", {
      store,
      timeoutMs: 180_000,
    });
    if (!Array.isArray(body?.products) || body.products.length === 0) {
      throw new AppError("UPSTREAM_ERROR", "Berkeley Bowl returned an empty catalog.");
    }
    const products = body.products.map(slimProduct).filter((p): p is Product => p !== null);
    const fetchedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO catalog_cache (store, fetched_at, payload_json) VALUES (?, ?, ?) " +
          "ON CONFLICT(store) DO UPDATE SET fetched_at = excluded.fetched_at, payload_json = excluded.payload_json",
      )
      .run(store.key, fetchedAt, JSON.stringify(products));
    log.info("Catalog ready", { store: store.key, products: products.length });
    return buildIndex(products, fetchedAt);
  }

  async refresh(store: StoreRef): Promise<CatalogIndex> {
    const running = this.inflight.get(store.key);
    if (running) return running;
    const job = this.download(store)
      .then((index) => {
        this.memory.set(store.key, index);
        return index;
      })
      .finally(() => this.inflight.delete(store.key));
    this.inflight.set(store.key, job);
    return job;
  }

  async get(store: StoreRef): Promise<CatalogIndex> {
    const index = this.memory.get(store.key) ?? this.loadFromDb(store);
    if (index) this.memory.set(store.key, index);
    if (index && this.isFresh(index.fetchedAt)) return index;
    try {
      return await this.refresh(store);
    } catch (error) {
      if (index) {
        log.warn("Catalog refresh failed; using the cached copy", { store: store.key });
        return index;
      }
      throw error;
    }
  }

  async getProduct(store: StoreRef, id: string): Promise<IndexedProduct | undefined> {
    return (await this.get(store)).byId.get(id);
  }
}

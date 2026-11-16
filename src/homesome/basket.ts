import { AppError } from "../errors.js";
import { normalizeCartQuantity } from "../matching/quantity.js";
import type { HomesomeClient } from "./client.js";
import type { CatalogService } from "./catalog.js";
import type { Cart, CartItem, Product, StoreRef } from "./types.js";

/** Guards against a runaway agent adding hundreds of an item. */
export const MAX_LINE_QUANTITY = 50;

type Raw = Record<string, unknown>;

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface AddLine {
  productId: string;
  quantity: number;
  instructions?: string;
  allowSubstitute?: boolean;
}

export interface LineResult {
  productId: string;
  name?: string;
  status: "ok" | "error";
  previousQuantity?: number;
  newQuantity?: number;
  note?: string;
  error?: string;
}

/** The fields the basket API needs to identify a product. */
type Identity = Pick<Product, "id" | "name" | "category" | "subType" | "organic">;

const body = (p: Identity, quantity: number, instructions: string, canReplace: boolean) => ({
  name: p.id,
  displayName: p.name,
  type: p.category,
  subType: p.subType,
  organic: p.organic,
  quantity,
  instructions,
  canReplace,
  isCustomItem: false,
});

export class BasketService {
  constructor(
    private readonly client: HomesomeClient,
    private readonly catalog: CatalogService,
  ) {}

  async get(store: StoreRef): Promise<Cart> {
    const raw = await this.client.request<Raw>("/user/basket?lite=true", { auth: true, store });
    const items = (Array.isArray(raw?.basketItems) ? raw.basketItems : []) as Raw[];
    const unavailable = (
      Array.isArray(raw?.unavailableBasketItems) ? raw.unavailableBasketItems : []
    ) as Raw[];
    return {
      store: store.key,
      items: items.map<CartItem>((i) => {
        const quantity = num(i.quantity);
        const price = num(i.price);
        return {
          productId: str(i.name),
          name: str(i.displayName),
          quantity,
          unit: str(i.unit) || "count",
          sellByQty: i.sellByQty === true,
          price,
          estimatedPrice: num(i.itemizedPrice, price * quantity),
          organic: i.organic === true,
          inStock: i.isInStock !== false,
          instructions: str(i.instructions),
        };
      }),
      unavailable: unavailable.map((i) => str(i.displayName) || str(i.name)),
      subtotal: num(raw?.basketSubTotal),
      tax: num(raw?.tax),
      total: num(raw?.basketTotal),
    };
  }

  private async post(store: StoreRef, lines: ReturnType<typeof body>[]): Promise<void> {
    if (lines.length === 0) return;
    await this.client.request("/user/basket", {
      method: "POST",
      auth: true,
      store,
      body: { items: lines },
    });
  }

  /** The API replaces a line's quantity, so adding means reading the cart and posting the sum. */
  async add(store: StoreRef, lines: AddLine[]): Promise<LineResult[]> {
    const cart = await this.get(store);
    const existing = new Map(cart.items.map((i) => [i.productId, i.quantity]));
    const results: LineResult[] = [];
    const toPost: ReturnType<typeof body>[] = [];
    const planned = new Map<string, number>();

    for (const line of lines) {
      const product = await this.catalog.getProduct(store, line.productId);
      if (!product) {
        results.push({
          productId: line.productId,
          status: "error",
          error: "Unknown product ID for this store.",
        });
        continue;
      }
      if (!product.inStock) {
        results.push({
          productId: product.id,
          name: product.name,
          status: "error",
          error: "Out of stock.",
        });
        continue;
      }
      const previous = planned.get(product.id) ?? existing.get(product.id) ?? 0;
      const target = normalizeCartQuantity(product, previous + line.quantity);
      if (target.quantity > MAX_LINE_QUANTITY) {
        results.push({
          productId: product.id,
          name: product.name,
          status: "error",
          error: `Quantity ${target.quantity} is above the safety limit of ${MAX_LINE_QUANTITY}.`,
        });
        continue;
      }
      planned.set(product.id, target.quantity);
      // A later line for the same product replaces the earlier one in the request.
      const at = toPost.findIndex((b) => b.name === product.id);
      const payload = body(
        product,
        target.quantity,
        line.instructions ?? "",
        line.allowSubstitute ?? true,
      );
      if (at >= 0) toPost[at] = payload;
      else toPost.push(payload);
      results.push({
        productId: product.id,
        name: product.name,
        status: "ok",
        previousQuantity: previous,
        newQuantity: target.quantity,
        note: target.note,
      });
    }
    await this.post(store, toPost);
    return results;
  }

  async setQuantity(store: StoreRef, productId: string, quantity: number): Promise<LineResult> {
    if (quantity === 0) {
      await this.remove(store, productId);
      return { productId, status: "ok", newQuantity: 0 };
    }
    const cart = await this.get(store);
    const inCart = cart.items.find((i) => i.productId === productId);
    const product = await this.catalog.getProduct(store, productId);
    if (!product && !inCart) {
      return { productId, status: "error", error: "Unknown product ID for this store." };
    }
    const identity: Identity & Partial<Product> = product ?? {
      id: productId,
      name: inCart!.name,
      category: "",
      subType: "",
      organic: inCart!.organic,
    };
    const target = product
      ? normalizeCartQuantity(product, quantity)
      : { quantity, note: undefined };
    if (target.quantity > MAX_LINE_QUANTITY) {
      return {
        productId,
        status: "error",
        error: `Quantity ${target.quantity} is above the safety limit of ${MAX_LINE_QUANTITY}.`,
      };
    }
    await this.post(store, [body(identity, target.quantity, inCart?.instructions ?? "", true)]);
    return {
      productId,
      name: identity.name,
      status: "ok",
      previousQuantity: inCart?.quantity ?? 0,
      newQuantity: target.quantity,
      note: target.note,
    };
  }

  async remove(store: StoreRef, productId: string): Promise<void> {
    if (!productId) throw new AppError("INVALID_INPUT", "productId is required.");
    await this.client.request(`/user/basket?itemName=${encodeURIComponent(productId)}`, {
      method: "DELETE",
      auth: true,
      store,
      body: {},
    });
  }

  async clear(store: StoreRef): Promise<number> {
    const cart = await this.get(store);
    for (const item of cart.items) await this.remove(store, item.productId);
    return cart.items.length;
  }
}

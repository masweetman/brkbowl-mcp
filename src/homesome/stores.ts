import { AppError } from "../errors.js";
import type { HomesomeClient } from "./client.js";
import type { StoreRef } from "./types.js";

interface RawLocation {
  name?: string;
  locName?: string;
  uniqueName?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string };
  priceLists?: { pListName?: string; uniqueName?: string; shoppingDisabled?: boolean }[];
}

const TTL_MS = 24 * 60 * 60 * 1000;

/** "berkeleybowlwest" -> "west" */
export function storeKey(locName: string): string {
  const key = locName
    .toLowerCase()
    .replace(/^berkeley\s*bowl/, "")
    .replace(/[^a-z0-9]+/g, "");
  return key || locName.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function prettyName(key: string): string {
  return `Berkeley Bowl ${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

export class StoreService {
  private cache: { at: number; stores: StoreRef[] } | undefined;

  constructor(
    private readonly client: HomesomeClient,
    private readonly defaultStore: string,
  ) {}

  async list(): Promise<StoreRef[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.stores;
    const raw = await this.client.request<RawLocation[]>("/locations");
    const stores: StoreRef[] = [];
    for (const loc of Array.isArray(raw) ? raw : []) {
      const online = loc.priceLists?.find((p) => p.pListName === "online" && !p.shoppingDisabled);
      if (!loc.uniqueName || !loc.locName || !online?.uniqueName) continue;
      const key = storeKey(loc.locName);
      const a = loc.address;
      stores.push({
        key,
        name: loc.name || prettyName(key),
        address: [a?.street, a?.city, a?.state, a?.zip].filter(Boolean).join(", "),
        locationId: loc.uniqueName,
        pricelistId: online.uniqueName,
      });
    }
    if (!stores.length) throw new AppError("UPSTREAM_ERROR", "No online stores were returned.");
    this.cache = { at: Date.now(), stores };
    return stores;
  }

  getDefaultKey(): string {
    return this.defaultStore;
  }

  async resolve(input?: string): Promise<StoreRef> {
    const stores = await this.list();
    const wanted = (input ?? this.defaultStore).toLowerCase().trim();
    const squashed = wanted.replace(/[^a-z0-9]+/g, "");
    const found =
      stores.find((s) => s.key === wanted || s.key === squashed) ??
      stores.find(
        (s) => squashed.includes(s.key) || s.name.toLowerCase().replace(/\W+/g, "") === squashed,
      );
    if (found) return found;
    // The configured default may be unavailable while exactly one store is open for online shopping.
    if (!input && stores.length === 1) return stores[0]!;
    throw new AppError(
      "STORE_UNAVAILABLE",
      `Unknown or unavailable store "${input ?? this.defaultStore}".`,
      `Available stores: ${stores.map((s) => s.key).join(", ")}. Use list_stores.`,
    );
  }
}

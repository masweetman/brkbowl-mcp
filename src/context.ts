import type { Config } from "./config.js";
import { MatchStore } from "./db/matches.js";
import { openDb, type Db } from "./db/index.js";
import { AuthService } from "./homesome/auth.js";
import { BasketService } from "./homesome/basket.js";
import { CatalogService } from "./homesome/catalog.js";
import { HomesomeClient } from "./homesome/client.js";
import { StoreService } from "./homesome/stores.js";
import { MatchingService } from "./matching/service.js";
import { SessionStore } from "./session/store.js";

export interface AppContext {
  config: Config;
  db: Db;
  session: SessionStore;
  client: HomesomeClient;
  stores: StoreService;
  auth: AuthService;
  catalog: CatalogService;
  basket: BasketService;
  matches: MatchStore;
  matching: MatchingService;
}

export function buildContext(
  config: Config,
  overrides: { db?: Db; fetchFn?: typeof fetch; minIntervalMs?: number } = {},
): AppContext {
  const db = overrides.db ?? openDb(config.DATA_DIR);
  const session = new SessionStore(config.DATA_DIR, config.SESSION_ENCRYPTION_KEY);
  const client = new HomesomeClient({
    baseUrl: config.HS_BASE_URL,
    apiKey: config.HS_API_KEY,
    session,
    fetchFn: overrides.fetchFn,
    minIntervalMs: overrides.minIntervalMs,
  });
  const stores = new StoreService(client, config.DEFAULT_STORE);
  const catalog = new CatalogService(client, db, config.CATALOG_TTL_HOURS);
  const matches = new MatchStore(db);
  return {
    config,
    db,
    session,
    client,
    stores,
    auth: new AuthService(client, session, stores, config.BB_PHONE),
    catalog,
    basket: new BasketService(client, catalog),
    matches,
    matching: new MatchingService(catalog, matches),
  };
}

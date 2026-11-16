import type { Db } from "./index.js";

export interface StoredMatch {
  store: string;
  key: string;
  productId: string;
  productName: string;
  defaultQuantity: number | null;
  timesUsed: number;
}

interface Row {
  store: string;
  list_text_norm: string;
  product_id: string;
  product_name: string;
  default_quantity: number | null;
  times_used: number;
}

const toMatch = (r: Row): StoredMatch => ({
  store: r.store,
  key: r.list_text_norm,
  productId: r.product_id,
  productName: r.product_name,
  defaultQuantity: r.default_quantity,
  timesUsed: r.times_used,
});

export class MatchStore {
  constructor(private readonly db: Db) {}

  get(store: string, key: string): StoredMatch | undefined {
    const row = this.db
      .prepare("SELECT * FROM matches WHERE store = ? AND list_text_norm = ?")
      .get(store, key) as Row | undefined;
    return row ? toMatch(row) : undefined;
  }

  upsert(m: Omit<StoredMatch, "timesUsed">): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO matches (store, list_text_norm, product_id, product_name, default_quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(store, list_text_norm) DO UPDATE SET
           product_id = excluded.product_id, product_name = excluded.product_name,
           default_quantity = excluded.default_quantity, updated_at = excluded.updated_at`,
      )
      .run(m.store, m.key, m.productId, m.productName, m.defaultQuantity, now, now);
  }

  touch(store: string, key: string): void {
    this.db
      .prepare(
        "UPDATE matches SET times_used = times_used + 1 WHERE store = ? AND list_text_norm = ?",
      )
      .run(store, key);
  }

  delete(store: string, key: string): boolean {
    const result = this.db
      .prepare("DELETE FROM matches WHERE store = ? AND list_text_norm = ?")
      .run(store, key);
    return Number(result.changes) > 0;
  }

  list(store: string): StoredMatch[] {
    return (
      this.db
        .prepare("SELECT * FROM matches WHERE store = ? ORDER BY list_text_norm")
        .all(store) as unknown as Row[]
    ).map(toMatch);
  }
}

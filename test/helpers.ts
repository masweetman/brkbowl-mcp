import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { buildContext, type AppContext } from "../src/context.js";
import { openMemoryDb } from "../src/db/index.js";
import { setLogLevel } from "../src/util/log.js";

setLogLevel("error");

export const TEST_TOKEN = "TEST_TOKEN_0123456789abcdef";
export const TEST_EMAIL = "user@example.com";
export const TEST_PHONE = "(555) 010-0123";
export const TEST_CODE = "123456";
export const LOCATION_ID = "LOC-WEST";
export const PRICELIST_ID = "PL-ONLINE";

interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

type Raw = Record<string, unknown>;

/** A small in-memory imitation of the Homesome API, backed by the sanitized catalog fixture. */
export class FakeHomesome {
  calls: Call[] = [];
  cart = new Map<string, { quantity: number; instructions: string; canReplace: boolean }>();
  catalog: Raw[] = (
    JSON.parse(readFileSync("test/fixtures/catalog-sample.json", "utf8")) as { products: Raw[] }
  ).products;
  sessionValid = true;
  codeSent = false;

  fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname + url.search;
    this.calls.push({ path, method, headers, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.pathname === "/locations") {
      return json([
        {
          name: "Berkeley Bowl West",
          locName: "berkeleybowlwest",
          uniqueName: LOCATION_ID,
          address: { street: "1 Example St.", city: "Berkeley", state: "CA", zip: "94700" },
          priceLists: [
            { pListName: "online", uniqueName: PRICELIST_ID, shoppingDisabled: false },
            { pListName: "cafe", uniqueName: "PL-CAFE", shoppingDisabled: false },
          ],
        },
      ]);
    }
    if (url.pathname === "/product/list") return json({ products: this.catalog });
    if (url.pathname === "/v2/user/verification/send") {
      this.codeSent = true;
      return json({ verificationInitiated: true, requiresSignup: false });
    }
    if (url.pathname === "/v2/user/verification/verify") {
      if (!this.codeSent || (body as Raw).code !== TEST_CODE)
        return json({ message: "bad code" }, 400);
      this.sessionValid = true;
      return json({
        verifiedAt: 1,
        user: {
          email: TEST_EMAIL,
          authToken: TEST_TOKEN,
          address: "1 Example St",
          phoneNumber: TEST_PHONE,
        },
      });
    }
    if (url.pathname === "/user/basket") {
      if (!this.sessionValid || headers.authtoken !== TEST_TOKEN) {
        return json({ message: "Unauthorized: Authentication required" }, 401);
      }
      if (method === "GET") return json(this.basketBody());
      if (method === "POST") {
        for (const item of (body as { items: Raw[] }).items) {
          this.cart.set(String(item.name), {
            quantity: Number(item.quantity),
            instructions: String(item.instructions ?? ""),
            canReplace: item.canReplace !== false,
          });
        }
        return json({ message: "Success" });
      }
      if (method === "DELETE") {
        this.cart.delete(url.searchParams.get("itemName") ?? "");
        return json({ message: "Success" });
      }
    }
    return json({ message: "not found" }, 404);
  };

  private basketBody() {
    const basketItems = [...this.cart].map(([name, line]) => {
      const p = this.catalog.find((c) => c.name === name)!;
      return {
        name,
        displayName: p.displayName,
        quantity: line.quantity,
        price: p.price,
        unit: p.unit,
        sellByQty: p.sellByQty,
        organic: p.organic,
        isInStock: true,
        instructions: line.instructions,
        itemizedPrice: Math.round(Number(p.price) * line.quantity * 100) / 100,
      };
    });
    const subtotal = basketItems.reduce((sum, i) => sum + i.itemizedPrice, 0);
    return {
      basketItems,
      unavailableBasketItems: [],
      basketSubTotal: subtotal,
      tax: 0,
      basketTotal: subtotal,
    };
  }

  product(predicate: (p: Raw) => boolean): Raw {
    const found = this.catalog.find(predicate);
    if (!found) throw new Error("fixture product not found");
    return found;
  }
}

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig(
    {
      DATA_DIR: mkdtempSync(join(tmpdir(), "brkbowl-test-")),
      SESSION_ENCRYPTION_KEY: "ab".repeat(32),
      BASE_URL: "http://localhost:3000",
      ADMIN_PASSWORD: "correct horse battery staple",
      MCP_BEARER_TOKEN: "static-bearer-token-for-tests-1234",
      BB_PHONE: TEST_PHONE,
      ...overrides,
    },
    "http",
  );
}

export function testContext(overrides: Record<string, string> = {}): {
  ctx: AppContext;
  fake: FakeHomesome;
} {
  const fake = new FakeHomesome();
  const ctx = buildContext(testConfig(overrides), {
    db: openMemoryDb(),
    fetchFn: fake.fetchFn,
    minIntervalMs: 0,
  });
  return { ctx, fake };
}

/** Log the test context in without going through the SMS flow. */
export function loginTestSession(ctx: AppContext): void {
  const now = new Date().toISOString();
  ctx.session.save({
    authToken: TEST_TOKEN,
    email: TEST_EMAIL,
    createdAt: now,
    lastVerifiedAt: now,
  });
}

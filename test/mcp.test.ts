import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { clearSecrets } from "../src/util/redact.js";
import {
  TEST_CODE,
  TEST_EMAIL,
  TEST_PHONE,
  TEST_TOKEN,
  testContext,
  type FakeHomesome,
} from "./helpers.js";
import type { AppContext } from "../src/context.js";

let ctx: AppContext;
let fake: FakeHomesome;
let client: Client;
const transcript: string[] = [];
const stderr: string[] = [];

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  transcript.push(text);
  const json =
    text.includes("{") || text.includes("[")
      ? JSON.parse(text.slice(text.search(/[{[]/)))
      : undefined;
  return { isError: result.isError === true, text, json };
}

beforeEach(async () => {
  transcript.length = 0;
  stderr.length = 0;
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  ({ ctx, fake } = testContext());
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSecrets();
});

describe("MCP tools", () => {
  it("exposes the expected tools and the workflow prompt", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_to_cart",
        "auth_status",
        "clear_cart",
        "forget_match",
        "get_cart",
        "get_product",
        "list_matches",
        "list_stores",
        "login_start",
        "login_verify",
        "logout",
        "match_items",
        "refresh_catalog",
        "remember_match",
        "remove_from_cart",
        "search_products",
        "set_cart_quantity",
      ].sort(),
    );
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("fill_cart_from_list");
    const prompt = await client.getPrompt({
      name: "fill_cart_from_list",
      arguments: { producePreference: "organic" },
    });
    expect(JSON.stringify(prompt.messages)).toContain("Never check out");
    expect(JSON.stringify(prompt.messages)).toContain("organic");
  });

  it("lists stores with the default marked", async () => {
    const { json } = await call("list_stores");
    expect(json).toEqual([expect.objectContaining({ store: "west", isDefault: true })]);
  });

  it("walks the whole workflow: login, match, remember, add, review", async () => {
    expect((await call("auth_status")).json).toMatchObject({ loggedIn: false });
    expect((await call("get_cart")).json).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

    await call("login_start");
    const verify = await call("login_verify", { code: TEST_CODE });
    expect(verify.isError).toBe(false);

    const matched = await call("match_items", {
      items: [{ text: "3 avocados" }, { text: "2 lb carrots" }, { text: "zzzxqv" }],
    });
    const results = matched.json as {
      status: string;
      candidates: { productId: string; suggestedCartQuantity: number; organic: boolean }[];
    }[];
    expect(results[0]!.candidates[0]!.organic).toBe(false);
    expect(results[0]!.candidates[0]!.suggestedCartQuantity).toBe(3);
    expect(results[2]!.status).toBe("noMatch");

    const avocado = results[0]!.candidates[0]!.productId;
    await call("remember_match", { listText: "avocados", productId: avocado, defaultQuantity: 2 });

    const again = (await call("match_items", { items: [{ text: "avocados" }] }))
      .json as typeof results;
    expect(again[0]).toMatchObject({ status: "remembered" });
    expect(again[0]!.candidates[0]!.suggestedCartQuantity).toBe(2);

    const added = await call("add_to_cart", {
      items: results.slice(0, 2).map((r) => ({
        productId: r.candidates[0]!.productId,
        quantity: r.candidates[0]!.suggestedCartQuantity,
      })),
    });
    expect(added.isError).toBe(false);
    expect(fake.cart.size).toBe(2);

    const cart = (await call("get_cart")).json as { items: unknown[]; total: number };
    expect(cart.items).toHaveLength(2);
    expect(cart.total).toBeGreaterThan(0);

    expect((await call("list_matches")).json).toHaveLength(1);
    expect((await call("forget_match", { listText: "avocados" })).json).toEqual({ removed: true });
  });

  it("requires explicit confirmation to clear the cart", async () => {
    await call("login_start");
    await call("login_verify", { code: TEST_CODE });
    const refused = await client.callTool({ name: "clear_cart", arguments: { confirm: false } });
    expect(refused.isError).toBe(true);
  });

  it("returns structured errors for unknown stores and products", async () => {
    expect((await call("search_products", { query: "kale", store: "mars" })).json).toMatchObject({
      error: { code: "STORE_UNAVAILABLE" },
    });
    expect((await call("get_product", { productId: "nope" })).json).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("never reveals the token, email, phone number or SMS code in any output or log", async () => {
    await call("login_start", { phone: "(555) 010-4567" });
    await call("login_verify", { code: TEST_CODE });
    await call("auth_status");
    await call("get_cart");
    await call("search_products", { query: "avocado" });
    await call("login_verify", { code: "999999" });
    await call("logout");

    const everything = [...transcript, ...stderr, JSON.stringify(await client.listTools())].join(
      "\n",
    );
    for (const secret of [
      TEST_TOKEN,
      TEST_EMAIL,
      TEST_PHONE,
      "010-4567",
      TEST_CODE,
      "1 Example St",
    ]) {
      expect(everything, `leaked ${secret}`).not.toContain(secret);
    }
  });
});

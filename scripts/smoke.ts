/* Live end-to-end check against the real Berkeley Bowl API, driven through the MCP tools.
 * Needs a saved session (login_start/login_verify, or `npm run import-session`).
 * It adds one avocado to the cart and removes it again; the cart is left as it was.
 *
 *   npm run smoke
 */
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { buildContext } from "../src/context.js";
import { createServer } from "../src/server.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const ctx = buildContext(loadConfig(process.env, "stdio"));
const server = createServer(ctx);
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(b);

async function call(name: string, args: Record<string, unknown> = {}) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]!.text;
  console.log(`\n# ${name} (${Date.now() - started} ms)${result.isError ? " ERROR" : ""}`);
  console.log(text.length > 1500 ? `${text.slice(0, 1500)}\n…` : text);
  const brace = text.search(/[{[]/);
  return brace >= 0 ? JSON.parse(text.slice(brace)) : undefined;
}

await call("list_stores");
const status = await call("auth_status");
if (!status.loggedIn) {
  console.error("\nNot logged in. Run `npm run import-session`, or use login_start/login_verify.");
  process.exit(1);
}
await call("search_products", { query: "avocados", limit: 3 });
await call("search_products", { query: "avocados", limit: 2, producePreference: "organic" });
const matched = await call("match_items", {
  items: [
    { text: "3 avocados" },
    { text: "2 lb carrots" },
    { text: "milk" },
    { text: "1 bunch cilantro" },
    { text: "bananas" },
  ],
});
const before = await call("get_cart");
const avocado = matched[0].candidates[0].productId as string;
await call("add_to_cart", { items: [{ productId: avocado, quantity: 1 }] });
await call("add_to_cart", { items: [{ productId: avocado, quantity: 2 }] });
await call("get_cart");
const existing = before.items.find((i: { productId: string }) => i.productId === avocado);
if (existing) await call("set_cart_quantity", { productId: avocado, quantity: existing.quantity });
else await call("remove_from_cart", { productId: avocado });
const after = await call("get_cart");
console.log(
  `\nCart restored: ${after.items.length === before.items.length ? "yes" : "NO — check the cart"}`,
);
await client.close();

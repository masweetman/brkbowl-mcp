/* eslint-disable no-console */
// Manual probe against the real Homesome API. Prints key NAMES, types and counts only,
// never values, so nothing personal lands in terminal history. Raw responses are written to
// ./data (git-ignored).
//
//   npm run probe -- send            sends an SMS code to BB_PHONE (from .env)
//   npm run probe -- verify 123456   verifies the code, stores the raw session in ./data
//   npm run probe -- cart            tests add/set/batch/remove semantics (restores the cart)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const BASE = process.env.HS_BASE_URL ?? "https://user-api.gethomesome.com";
const BASE_HEADERS = {
  apikey: process.env.HS_API_KEY ?? "C431BB1B-2A40-4716-BD55-B583E8CB6B2B",
  location: "D44A803B-F0B3-40E1-8CED-25050C158A77",
  pricelist: "21B333E4-BB22-4A5B-9390-D25B2BF782E3",
  "Content-Type": "application/json",
  "User-Agent": "brkbowl-mcp-probe/0.1",
};
const SESSION_FILE = "data/probe-verify.json";

function shape(value: unknown, depth = 2): unknown {
  if (Array.isArray(value))
    return value.length ? [`array(${value.length})`, shape(value[0], depth)] : "array(0)";
  if (value && typeof value === "object") {
    if (depth === 0) return "object";
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth - 1)]));
  }
  return value === null ? "null" : typeof value;
}

async function call(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (init.auth) {
    const { token, email } = loadAuth();
    headers.authtoken = token;
    headers.emailid = email.replace("^", "");
  }
  const res = await fetch(BASE + path, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, json, text };
}

function find(obj: unknown, names: string[]): string | undefined {
  const queue: unknown[] = [obj];
  while (queue.length) {
    const cur = queue.shift();
    if (cur && typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (names.includes(k.toLowerCase()) && typeof v === "string") return v;
        queue.push(v);
      }
    }
  }
  return undefined;
}

function loadAuth() {
  const raw = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  const token = find(raw, ["authtoken", "token", "accesstoken"]);
  const email = find(raw, ["email", "emailid"]);
  if (!token || !email) throw new Error("Could not find token/email in saved verify response");
  return { token, email };
}

async function send() {
  const phone = process.env.BB_PHONE;
  if (!phone) throw new Error("Set BB_PHONE in .env first");
  const { res, json, text } = await call("/v2/user/verification/send", {
    method: "POST",
    body: { phoneNumber: phone, shouldCall: false, forLogin: true },
  });
  console.log(
    "status",
    res.status,
    "body shape:",
    JSON.stringify(json === undefined ? `non-json(${text.length})` : shape(json)),
  );
}

async function verify(code: string) {
  const phone = process.env.BB_PHONE;
  if (!phone) throw new Error("Set BB_PHONE in .env first");
  const { res, json, text } = await call("/v2/user/verification/verify", {
    method: "POST",
    body: { code, phoneNumber: phone },
  });
  console.log("status", res.status);
  console.log(
    "response headers (names):",
    [...res.headers.keys()].filter((h) => /token|auth|refresh/i.test(h)),
  );
  if (json === undefined) return console.log("non-json body, length", text.length);
  console.log("Q1 body shape:", JSON.stringify(shape(json, 3), null, 1));
  mkdirSync("data", { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(json), { mode: 0o600 });
  const { token, email } = loadAuth();
  console.log("found token:", token.length, "chars; email present:", email.includes("@"));
  const check = await call("/user/basket?lite=true", { auth: true });
  console.log("auth check GET /user/basket:", check.res.status);
}

type CartItem = { name: string; quantity: number };
async function basket(): Promise<CartItem[]> {
  const { res, json } = await call("/user/basket?lite=true", { auth: true });
  if (res.status !== 200) throw new Error(`basket ${res.status}`);
  const items = (json as { basketItems?: Record<string, unknown>[] })?.basketItems ?? [];
  return items.map((i) => ({ name: String(i.name), quantity: Number(i.quantity) }));
}

const TEST_PRODUCTS = [
  {
    name: "avocado",
    displayName: "Medium Hass Avocados",
    type: "Produce",
    subType: "Avocados",
    organic: false,
  },
  {
    name: "lemons-large-4053",
    displayName: "Medium Lemons",
    type: "Produce",
    subType: "Citrus",
    organic: false,
  },
];
const line = (p: (typeof TEST_PRODUCTS)[number], quantity: number) => ({
  ...p,
  quantity,
  canReplace: true,
  instructions: "",
  isCustomItem: false,
});
const post = (items: unknown[]) =>
  call("/user/basket", { method: "POST", auth: true, body: { items } });
const qty = (items: CartItem[], name: string) => items.find((i) => i.name === name)?.quantity ?? 0;

async function cart() {
  const [a, b] = TEST_PRODUCTS as [(typeof TEST_PRODUCTS)[number], (typeof TEST_PRODUCTS)[number]];
  const before = await basket();
  console.log("starting cart lines:", before.length);
  const { json: full } = await call("/user/basket?lite=true", { auth: true });
  const first = (full as { basketItems?: unknown[] })?.basketItems?.[0];
  if (first) console.log("basket item shape:", JSON.stringify(shape(first, 1)));
  console.log("basket top-level shape:", JSON.stringify(shape(full, 1)));

  try {
    const r1 = await post([line(a, 1)]);
    console.log("POST 1 status", r1.res.status, "shape", JSON.stringify(shape(r1.json, 1)));
    const { json: withItem } = await call("/user/basket?lite=true", { auth: true });
    const item = (withItem as { basketItems?: unknown[] })?.basketItems?.[0];
    console.log("basket item shape:", JSON.stringify(shape(item, 1)));
    console.log("basket totals present:", JSON.stringify(shape(withItem, 0)));
    const q1 = qty(await basket(), a.name);
    await post([line(a, 1)]);
    const q2 = qty(await basket(), a.name);
    console.log(
      `Q2: after posting 1 then 1 again, quantity = ${q2} (was ${q1}) =>`,
      q2 === q1 ? "POST SETS quantity" : q2 === q1 + 1 ? "POST ADDS quantity" : "unexpected",
    );
    await post([line(a, 3)]);
    console.log("Q2b: posting 3 =>", qty(await basket(), a.name));

    const r3 = await post([line(a, 2), line(b, 2)]);
    const after = await basket();
    console.log(
      "Q3: batch status",
      r3.res.status,
      "=> qty",
      a.name,
      qty(after, a.name),
      b.name,
      qty(after, b.name),
    );

    const del = await call(`/user/basket?itemName=${encodeURIComponent(b.name)}`, {
      method: "DELETE",
      auth: true,
      body: {},
    });
    console.log("DELETE status", del.res.status, "=> remaining qty", qty(await basket(), b.name));
  } finally {
    for (const p of TEST_PRODUCTS) {
      if (qty(before, p.name) === 0)
        await call(`/user/basket?itemName=${encodeURIComponent(p.name)}`, {
          method: "DELETE",
          auth: true,
          body: {},
        });
      else await post([line(p, qty(before, p.name))]);
    }
    const restored = await basket();
    console.log(
      "cart restored:",
      restored.length === before.length ? "lines match" : "LINE COUNT DIFFERS",
      `(${restored.length} vs ${before.length})`,
    );
  }
}

const [cmd, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  send,
  verify: () => verify(arg ?? ""),
  cart,
};
const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.error("usage: probe <send | verify CODE | cart>");
  process.exit(1);
}
run().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

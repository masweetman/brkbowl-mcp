import { createHash, randomBytes } from "node:crypto";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext } from "../src/context.js";
import { openMemoryDb } from "../src/db/index.js";
import { createApp } from "../src/http/app.js";
import { isAllowedRedirect } from "../src/http/oauth/provider.js";
import { FakeHomesome, testConfig } from "./helpers.js";

const PASSWORD = "correct horse battery staple";
const BEARER = "static-bearer-token-for-tests-1234";
const REDIRECT = "http://127.0.0.1:9999/callback";

let server: Server;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

beforeEach(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const config = testConfig({ BASE_URL: base, ADMIN_PASSWORD: PASSWORD, MCP_BEARER_TOKEN: BEARER });
  const ctx = buildContext(config, {
    db: openMemoryDb(),
    fetchFn: new FakeHomesome().fetchFn,
    minIntervalMs: 0,
  });
  await new Promise<void>((resolve) => {
    server = createApp(ctx).listen(port, () => resolve());
  });
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

async function register(redirect = REDIRECT) {
  return fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test <b>Client</b>",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
}

async function authorize(clientId: string, verifier: string) {
  const url = new URL(`${base}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
    state: "xyz",
  }).toString();
  const res = await fetch(url);
  const html = await res.text();
  return { res, html, requestId: /name="request_id" value="([^"]+)"/.exec(html)?.[1] ?? "" };
}

const login = (requestId: string, password: string) =>
  fetch(`${base}/oauth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request_id: requestId, password }),
  });

const token = (body: Record<string, string>) =>
  fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

async function fullFlow() {
  const clientId = ((await (await register()).json()) as { client_id: string }).client_id;
  const verifier = randomBytes(32).toString("base64url");
  const { requestId } = await authorize(clientId, verifier);
  const approved = await login(requestId, PASSWORD);
  const location = new URL(approved.headers.get("location")!);
  const tokens = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: location.searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
  });
  return { clientId, verifier, location, tokens };
}

describe("redirect allow-list", () => {
  it.each([
    ["https://claude.ai/api/mcp/auth_callback", true],
    ["https://claude.com/api/mcp/auth_callback", true],
    ["https://vscode.dev/redirect", true],
    ["http://127.0.0.1:33418/", true],
    ["http://localhost:8080/cb", true],
    ["vscode://ms-vscode.mcp/callback", true],
    ["https://evil.example.com/cb", false],
    ["https://claude.ai.evil.example.com/cb", false],
    ["http://claude.ai/cb", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s -> %s", (uri, allowed) => {
    expect(isAllowedRedirect(uri)).toBe(allowed);
  });
  it("accepts extra configured hosts", () => {
    expect(
      isAllowedRedirect("https://my.home-assistant.io/redirect", ["my.home-assistant.io"]),
    ).toBe(true);
  });
});

describe("OAuth", () => {
  it("publishes discovery metadata", async () => {
    const meta = (await (
      await fetch(`${base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(meta).toMatchObject({ issuer: `${base}/`, code_challenge_methods_supported: ["S256"] });
    const resource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(resource.status).toBe(200);
  });

  it("refuses to register a client with a redirect to an unknown site", async () => {
    expect((await register("https://evil.example.com/cb")).status).toBe(400);
  });

  it("escapes the client name on the login page and locks it down", async () => {
    const clientId = ((await (await register()).json()) as { client_id: string }).client_id;
    const { res, html } = await authorize(clientId, "v".repeat(43));
    expect(html).toContain("Test &lt;b&gt;Client&lt;/b&gt;");
    expect(html).not.toContain("<b>Client</b>");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("rejects a wrong password and accepts the right one", async () => {
    const clientId = ((await (await register()).json()) as { client_id: string }).client_id;
    const { requestId } = await authorize(clientId, "v".repeat(43));
    expect((await login(requestId, "nope")).status).toBe(401);
    const ok = await login(requestId, PASSWORD);
    expect(ok.status).toBe(302);
    const location = new URL(ok.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("completes the flow, and the access token reaches /mcp through a real MCP client", async () => {
    const { tokens } = await fullFlow();
    expect(tokens.status).toBe(200);
    const body = (await tokens.json()) as { access_token: string; refresh_token: string };

    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${body.access_token}` } },
      }),
    );
    expect((await client.listTools()).tools.length).toBeGreaterThan(10);
    await client.close();
  });

  it("rejects a wrong PKCE verifier, and a code only works once", async () => {
    const clientId = ((await (await register()).json()) as { client_id: string }).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const { requestId } = await authorize(clientId, verifier);
    const code = new URL(
      (await login(requestId, PASSWORD)).headers.get("location")!,
    ).searchParams.get("code")!;
    const common = {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
    };

    expect((await token({ ...common, code_verifier: "x".repeat(43) })).status).toBe(400);
    expect((await token({ ...common, code_verifier: verifier })).status).toBe(200);
    expect((await token({ ...common, code_verifier: verifier })).status).toBe(400);
  });

  it("rotates refresh tokens", async () => {
    const { clientId, tokens } = await fullFlow();
    const first = (await tokens.json()) as { refresh_token: string };
    const refreshed = await token({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: first.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(
      (
        await token({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: first.refresh_token,
        })
      ).status,
    ).toBe(400);
  });

  it("blocks guessing after repeated wrong passwords, even with the right one", async () => {
    const clientId = ((await (await register()).json()) as { client_id: string }).client_id;
    for (let i = 0; i < 5; i++) {
      const { requestId } = await authorize(clientId, "v".repeat(43));
      expect((await login(requestId, `wrong-${i}`)).status).toBe(401);
    }
    const { requestId } = await authorize(clientId, "v".repeat(43));
    expect((await login(requestId, PASSWORD)).status).toBe(429);
  });
});

describe("/mcp access control", () => {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    },
  };
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(init),
    });

  it("is open only to health checks without credentials", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const denied = await post({});
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("resource_metadata");
    expect((await post({ Authorization: "Bearer wrong-token" })).status).toBe(401);
  });

  it("accepts the static bearer token", async () => {
    expect((await post({ Authorization: `Bearer ${BEARER}` })).status).toBe(200);
  });

  it("does not allow GET or DELETE", async () => {
    expect(
      (await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${BEARER}` } })).status,
    ).toBe(405);
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${BEARER}` },
        })
      ).status,
    ).toBe(405);
    expect((await fetch(`${base}/mcp`)).status).toBe(401);
  });
});

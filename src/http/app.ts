import express, { type Express, type Request, type Response } from "express";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppContext } from "../context.js";
import { createServer } from "../server.js";
import { log } from "../util/log.js";
import { SingleUserOAuthProvider, safeEqual } from "./oauth/provider.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_TOTAL = 20;

/** Counts failed password attempts per client IP and overall, within a sliding window. */
class LoginLimiter {
  private readonly perIp = new Map<string, number[]>();
  private total: number[] = [];

  private prune(list: number[], now: number): number[] {
    return list.filter((t) => now - t < WINDOW_MS);
  }

  blocked(ip: string): boolean {
    const now = Date.now();
    this.total = this.prune(this.total, now);
    const mine = this.prune(this.perIp.get(ip) ?? [], now);
    this.perIp.set(ip, mine);
    return mine.length >= MAX_FAILURES_PER_IP || this.total.length >= MAX_FAILURES_TOTAL;
  }

  fail(ip: string): void {
    const now = Date.now();
    this.total.push(now);
    this.perIp.set(ip, [...this.prune(this.perIp.get(ip) ?? [], now), now]);
  }
}

function buildVerifier(
  provider: SingleUserOAuthProvider | undefined,
  staticToken: string | undefined,
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      if (staticToken && safeEqual(token, staticToken)) {
        return {
          token,
          clientId: "static-bearer",
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        };
      }
      if (provider) return provider.verifyAccessToken(token);
      throw new InvalidTokenError("Invalid token");
    },
  };
}

export function createApp(ctx: AppContext): Express {
  const { config } = ctx;
  const app = express();
  app.disable("x-powered-by");
  // Behind cloudflared/Docker the real client IP arrives in X-Forwarded-For from a private address.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  const baseUrl = new URL(config.BASE_URL!);
  const mcpUrl = new URL("/mcp", baseUrl);
  let provider: SingleUserOAuthProvider | undefined;

  if (config.ADMIN_PASSWORD) {
    provider = new SingleUserOAuthProvider(ctx.db, {
      adminPassword: config.ADMIN_PASSWORD,
      extraRedirectHosts: config.ALLOWED_REDIRECT_HOSTS,
    });
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: baseUrl,
        resourceServerUrl: mcpUrl,
        resourceName: "brkbowl-mcp",
      }),
    );

    const limiter = new LoginLimiter();
    app.post(
      "/oauth/login",
      express.urlencoded({ extended: false, limit: "10kb" }),
      (req: Request, res: Response) => {
        const ip = req.ip ?? "unknown";
        const requestId = typeof req.body?.request_id === "string" ? req.body.request_id : "";
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        const entry = provider!.peek(requestId);
        if (!entry) {
          res
            .status(400)
            .type("text/plain")
            .send("This sign-in request expired. Start again from your app.");
          return;
        }
        if (limiter.blocked(ip)) {
          log.warn("Login blocked by rate limit");
          res.status(429).type("text/plain").send("Too many attempts. Try again later.");
          return;
        }
        if (!provider!.checkPassword(password)) {
          limiter.fail(ip);
          log.warn("Failed admin password attempt");
          provider!.sendPage(res, requestId, entry.client, "Wrong password.", 401);
          return;
        }
        const target = provider!.approve(requestId);
        if (!target) {
          res
            .status(400)
            .type("text/plain")
            .send("This sign-in request expired. Start again from your app.");
          return;
        }
        res.set("Cache-Control", "no-store").redirect(302, target);
      },
    );
  }

  const requireAuth = requireBearerAuth({
    verifier: buildVerifier(provider, config.MCP_BEARER_TOKEN),
    resourceMetadataUrl: provider ? getOAuthProtectedResourceMetadataUrl(mcpUrl) : undefined,
  });

  app.post("/mcp", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
    // Stateless: a fresh server and transport per request, all sharing the same context.
    const server = createServer(ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log.error("MCP request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res
      .set("Allow", "POST")
      .status(405)
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
  };
  app.get("/mcp", requireAuth, notAllowed);
  app.delete("/mcp", requireAuth, notAllowed);

  return app;
}

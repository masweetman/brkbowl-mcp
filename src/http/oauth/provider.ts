import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Db } from "../../db/index.js";
import { loginPage } from "./page.js";

const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const CODE_TTL_S = 5 * 60;
const PENDING_TTL_MS = 10 * 60 * 1000;

const DEFAULT_HOSTS = ["claude.ai", "claude.com", "vscode.dev", "insiders.vscode.dev"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ALLOWED_SCHEMES = new Set(["vscode:", "vscode-insiders:"]);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);

export function isAllowedRedirect(uri: string, extraHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (ALLOWED_SCHEMES.has(url.protocol)) return true;
  if (url.protocol === "http:") return LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return [...DEFAULT_HOSTS, ...extraHosts.map((h) => h.toLowerCase())].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

interface Pending {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  expires: number;
}

export interface ProviderOptions {
  adminPassword: string;
  extraRedirectHosts: string[];
}

export class SingleUserOAuthProvider implements OAuthServerProvider {
  private readonly pending = new Map<string, Pending>();
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly db: Db,
    private readonly options: ProviderOptions,
  ) {
    this.clientsStore = {
      getClient: (clientId) => {
        const row = this.db
          .prepare("SELECT client_json FROM oauth_clients WHERE client_id = ?")
          .get(clientId) as { client_json: string } | undefined;
        return row ? (JSON.parse(row.client_json) as OAuthClientInformationFull) : undefined;
      },
      registerClient: (client) => {
        for (const uri of client.redirect_uris) {
          if (!isAllowedRedirect(String(uri), this.options.extraRedirectHosts)) {
            throw new InvalidClientMetadataError(
              `redirect_uri not allowed: ${String(uri).slice(0, 80)}`,
            );
          }
        }
        const full = client as OAuthClientInformationFull;
        this.db
          .prepare(
            "INSERT INTO oauth_clients (client_id, client_json, created_at) VALUES (?, ?, ?)",
          )
          .run(full.client_id, JSON.stringify(full), nowS());
        return full;
      },
    };
  }

  // --- Authorization: show a password page, then issue a code ------------------------------------

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.sweep();
    const id = newSecret();
    this.pending.set(id, { client, params, expires: Date.now() + PENDING_TTL_MS });
    this.sendPage(res, id, client);
  }

  sendPage(
    res: Response,
    requestId: string,
    client: OAuthClientInformationFull,
    error?: string,
    status = 200,
  ): void {
    res
      .status(status)
      .set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        // No form-action: browsers apply it to the redirect back to the client app.
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      })
      .send(loginPage({ requestId, clientName: client.client_name ?? client.client_id, error }));
  }

  peek(requestId: string): Pending | undefined {
    const entry = this.pending.get(requestId);
    if (!entry || entry.expires < Date.now()) {
      this.pending.delete(requestId);
      return undefined;
    }
    return entry;
  }

  checkPassword(candidate: string): boolean {
    return safeEqual(candidate, this.options.adminPassword);
  }

  /** Call after the password is accepted. Returns the URL to send the browser back to the client app. */
  approve(requestId: string): string | undefined {
    const entry = this.peek(requestId);
    if (!entry) return undefined;
    this.pending.delete(requestId);
    const { client, params } = entry;
    const code = newSecret();
    this.db
      .prepare(
        "INSERT INTO oauth_codes (code_hash, client_id, code_challenge, redirect_uri, resource, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        sha256(code),
        client.client_id,
        params.codeChallenge,
        params.redirectUri,
        params.resource?.href ?? null,
        JSON.stringify(params.scopes ?? []),
        nowS() + CODE_TTL_S,
      );
    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    return target.href;
  }

  // --- Token endpoint -------------------------------------------------------------------------

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    const row = this.db
      .prepare("SELECT code_challenge, client_id, expires_at FROM oauth_codes WHERE code_hash = ?")
      .get(sha256(code)) as
      { code_challenge: string; client_id: string; expires_at: number } | undefined;
    if (!row || row.client_id !== client.client_id || row.expires_at < nowS()) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const hash = sha256(code);
    const row = this.db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(hash) as
      | {
          client_id: string;
          redirect_uri: string;
          resource: string | null;
          scopes: string;
          expires_at: number;
        }
      | undefined;
    // Codes are single use whatever happens next.
    this.db.prepare("DELETE FROM oauth_codes WHERE code_hash = ?").run(hash);
    if (!row || row.client_id !== client.client_id || row.expires_at < nowS()) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    if (redirectUri && redirectUri !== row.redirect_uri)
      throw new InvalidGrantError("redirect_uri mismatch");
    return this.issue(
      client.client_id,
      JSON.parse(row.scopes) as string[],
      row.resource,
      randomBytes(8).toString("hex"),
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const hash = sha256(refreshToken);
    const row = this.db
      .prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'")
      .get(hash) as
      | {
          client_id: string;
          scopes: string;
          resource: string | null;
          expires_at: number;
          family: string;
        }
      | undefined;
    if (!row || row.client_id !== client.client_id || row.expires_at < nowS()) {
      throw new InvalidGrantError("Invalid or expired refresh token");
    }
    // Rotate: the old refresh token stops working.
    this.db.prepare("DELETE FROM oauth_tokens WHERE token_hash = ?").run(hash);
    return this.issue(
      client.client_id,
      scopes ?? (JSON.parse(row.scopes) as string[]),
      row.resource,
      row.family,
    );
  }

  private issue(
    clientId: string,
    scopes: string[],
    resource: string | null,
    family: string,
  ): OAuthTokens {
    const access = newSecret();
    const refresh = newSecret();
    const insert = this.db.prepare(
      "INSERT INTO oauth_tokens (token_hash, kind, client_id, scopes, resource, expires_at, family) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      sha256(access),
      "access",
      clientId,
      JSON.stringify(scopes),
      resource,
      nowS() + ACCESS_TTL_S,
      family,
    );
    insert.run(
      sha256(refresh),
      "refresh",
      clientId,
      JSON.stringify(scopes),
      resource,
      nowS() + REFRESH_TTL_S,
      family,
    );
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: scopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db
      .prepare(
        "SELECT client_id, scopes, resource, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'",
      )
      .get(sha256(token)) as
      | { client_id: string; scopes: string; resource: string | null; expires_at: number }
      | undefined;
    if (!row || row.expires_at < nowS()) throw new InvalidTokenError("Invalid or expired token");
    return {
      token,
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes) as string[],
      expiresAt: row.expires_at,
      ...(row.resource ? { resource: new URL(row.resource) } : {}),
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const hash = sha256(request.token);
    const row = this.db
      .prepare("SELECT client_id, family FROM oauth_tokens WHERE token_hash = ?")
      .get(hash) as { client_id: string; family: string } | undefined;
    if (row && row.client_id === client.client_id) {
      this.db.prepare("DELETE FROM oauth_tokens WHERE family = ?").run(row.family);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.pending) if (entry.expires < now) this.pending.delete(id);
    this.db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(nowS());
    this.db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(nowS());
  }
}

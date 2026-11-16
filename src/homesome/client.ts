import { AUTH_HINT, AppError } from "../errors.js";
import type { SessionStore } from "../session/store.js";
import type { StoreRef } from "./types.js";

export class UpstreamError extends AppError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super("UPSTREAM_ERROR", message);
    this.name = "UpstreamError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  store?: Pick<StoreRef, "locationId" | "pricelistId">;
  auth?: boolean;
  timeoutMs?: number;
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  session: SessionStore;
  fetchFn?: typeof fetch;
  /** Minimum gap between upstream requests (keeps us at or below ~2 requests/second). */
  minIntervalMs?: number;
}

export class HomesomeClient {
  private readonly fetchFn: typeof fetch;
  private readonly minIntervalMs: number;
  private nextSlot = 0;

  constructor(private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 500;
  }

  private async gate(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.minIntervalMs;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.opts.apiKey,
      "Content-Type": "application/json",
      "User-Agent": "brkbowl-mcp/0.1 (personal use)",
    };
    if (options.store) {
      headers.location = options.store.locationId;
      headers.pricelist = options.store.pricelistId;
    }
    if (options.auth) {
      const session = this.opts.session.load();
      if (!session)
        throw new AppError("AUTH_REQUIRED", "Not logged in to Berkeley Bowl.", AUTH_HINT);
      headers.authtoken = session.authToken;
      headers.emailid = session.email.replace("^", "");
    }

    await this.gate();
    let res: Response;
    try {
      res = await this.fetchFn(this.opts.baseUrl + path, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new UpstreamError(
        timedOut ? "Berkeley Bowl did not respond in time." : "Could not reach Berkeley Bowl.",
      );
    }

    // Response bodies can contain personal data, so error messages only ever carry the status.
    if (res.status === 401 && options.auth) {
      this.opts.session.clear();
      throw new AppError("AUTH_REQUIRED", "The Berkeley Bowl session has expired.", AUTH_HINT);
    }
    if (res.status === 403) {
      throw new AppError(
        "CONFIG_ERROR",
        "Berkeley Bowl rejected the store or price list (HTTP 403).",
        "Check the store setting with list_stores.",
      );
    }
    if (!res.ok) throw new UpstreamError(`Berkeley Bowl returned HTTP ${res.status}.`, res.status);

    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new UpstreamError("Berkeley Bowl returned a response that is not JSON.");
    }
  }
}

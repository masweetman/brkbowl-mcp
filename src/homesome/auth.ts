import { AUTH_HINT, AppError } from "../errors.js";
import type { SessionStore } from "../session/store.js";
import { maskPhone, registerSecret } from "../util/redact.js";
import { UpstreamError, type HomesomeClient } from "./client.js";
import type { StoreService } from "./stores.js";

const SEND_INTERVAL_MS = 60_000;

/** Formats any US phone number the way the website does: (415) 555-0100. */
export function formatPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) {
    throw new AppError("INVALID_INPUT", "Phone number must have 10 digits, e.g. (555) 010-0000.");
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function findString(root: unknown, path: string[]): string | undefined {
  let cur = root;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" && cur ? cur : undefined;
}

/** Looks in the documented place first, then a few plausible alternatives. */
export function extractCredentials(body: unknown): { authToken: string; email: string } | null {
  const authToken =
    findString(body, ["user", "authToken"]) ??
    findString(body, ["authToken"]) ??
    findString(body, ["token"]);
  const email = findString(body, ["user", "email"]) ?? findString(body, ["email"]);
  return authToken && email ? { authToken, email } : null;
}

function keyNames(body: unknown): string {
  if (!body || typeof body !== "object") return typeof body;
  return Object.keys(body).join(", ");
}

export class AuthService {
  private lastSend = 0;
  private pendingPhone: string | undefined;

  constructor(
    private readonly client: HomesomeClient,
    private readonly session: SessionStore,
    private readonly stores: StoreService,
    private readonly defaultPhone: string | undefined,
  ) {}

  async start(
    phoneInput?: string,
  ): Promise<{ sent: true; phone: string; requiresSignup: boolean }> {
    const raw = phoneInput ?? this.defaultPhone ?? this.session.load()?.phone;
    if (!raw) {
      throw new AppError(
        "INVALID_INPUT",
        "No phone number available.",
        "Pass phone to login_start, or set BB_PHONE on the server.",
      );
    }
    const phone = formatPhone(raw);
    const wait = this.lastSend + SEND_INTERVAL_MS - Date.now();
    if (wait > 0) {
      throw new AppError(
        "RATE_LIMITED",
        `A code was just sent. Wait ${Math.ceil(wait / 1000)} seconds before requesting another.`,
      );
    }
    const store = await this.stores.resolve();
    const res = await this.client.request<{
      verificationInitiated?: boolean;
      requiresSignup?: boolean;
    }>("/v2/user/verification/send", {
      method: "POST",
      store,
      body: { phoneNumber: phone, shouldCall: false, forLogin: true },
    });
    this.lastSend = Date.now();
    if (res?.verificationInitiated === false) {
      throw new UpstreamError("Berkeley Bowl did not send a code.");
    }
    this.pendingPhone = phone;
    return { sent: true, phone: maskPhone(phone), requiresSignup: res?.requiresSignup === true };
  }

  async verify(code: string): Promise<{ loggedIn: true; phone: string }> {
    const cleaned = code.replace(/\s+/g, "");
    if (!/^\d{4,8}$/.test(cleaned))
      throw new AppError("INVALID_INPUT", "The code should be 4 to 8 digits.");
    registerSecret(cleaned);

    const raw = this.pendingPhone ?? this.defaultPhone ?? this.session.load()?.phone;
    if (!raw) {
      throw new AppError("INVALID_INPUT", "No pending login.", "Call login_start first.");
    }
    const phone = formatPhone(raw);
    const store = await this.stores.resolve();

    let body: unknown;
    try {
      body = await this.client.request("/v2/user/verification/verify", {
        method: "POST",
        store,
        body: { code: cleaned, phoneNumber: phone },
      });
    } catch (error) {
      if (
        error instanceof UpstreamError &&
        error.status &&
        error.status >= 400 &&
        error.status < 500
      ) {
        throw new AppError(
          "INVALID_INPUT",
          "The code was rejected. It may be wrong or expired.",
          "Call login_start for a new code.",
        );
      }
      throw error;
    }

    const creds = extractCredentials(body);
    if (!creds) {
      throw new UpstreamError(
        `Login succeeded but the response had no token. Top-level fields: ${keyNames(body)}.`,
      );
    }
    registerSecret(creds.authToken);
    const now = new Date().toISOString();
    this.session.save({ ...creds, phone, createdAt: now, lastVerifiedAt: now });
    this.pendingPhone = undefined;
    return { loggedIn: true, phone: maskPhone(phone) };
  }

  async status(): Promise<{ loggedIn: boolean; phone?: string; since?: string; hint?: string }> {
    const session = this.session.load();
    if (!session) return { loggedIn: false, hint: AUTH_HINT };
    try {
      const store = await this.stores.resolve();
      await this.client.request("/user/basket?lite=true", { auth: true, store });
    } catch (error) {
      if (error instanceof AppError && error.code === "AUTH_REQUIRED") {
        return { loggedIn: false, hint: AUTH_HINT };
      }
      throw error;
    }
    this.session.touch();
    return {
      loggedIn: true,
      phone: session.phone ? maskPhone(session.phone) : undefined,
      since: session.createdAt,
    };
  }

  logout(): { loggedIn: false } {
    this.session.clear();
    return { loggedIn: false };
  }
}

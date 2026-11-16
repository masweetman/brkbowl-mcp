import { describe, expect, it } from "vitest";
import { AUTH_HINT } from "../src/errors.js";
import { extractCredentials, formatPhone } from "../src/homesome/auth.js";
import {
  LOCATION_ID,
  PRICELIST_ID,
  TEST_CODE,
  TEST_EMAIL,
  TEST_PHONE,
  TEST_TOKEN,
  loginTestSession,
  testContext,
} from "./helpers.js";

describe("formatPhone", () => {
  it.each([
    ["5550100100", "(555) 010-0100"],
    ["(555) 010-0100", "(555) 010-0100"],
    ["+1 555-010-0100", "(555) 010-0100"],
    ["1.555.010.0100", "(555) 010-0100"],
  ])("%s", (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });
  it("rejects numbers that are not 10 digits", () => {
    expect(() => formatPhone("555-0100")).toThrow(/10 digits/);
  });
});

describe("extractCredentials", () => {
  it("reads the documented shape and a few alternatives", () => {
    expect(extractCredentials({ user: { authToken: "t", email: "e@example.com" } })).toEqual({
      authToken: "t",
      email: "e@example.com",
    });
    expect(extractCredentials({ authToken: "t", email: "e@example.com" })).toEqual({
      authToken: "t",
      email: "e@example.com",
    });
  });
  it("returns null when something is missing", () => {
    expect(extractCredentials({ user: { email: "e@example.com" } })).toBeNull();
    expect(extractCredentials(null)).toBeNull();
  });
});

describe("login flow", () => {
  it("sends a code, verifies it, and saves only the token and email", async () => {
    const { ctx, fake } = testContext();
    const started = await ctx.auth.start();
    expect(started).toMatchObject({ sent: true, phone: "***-***-0123" });

    const send = fake.calls.find((c) => c.path === "/v2/user/verification/send")!;
    expect(send.body).toEqual({ phoneNumber: TEST_PHONE, shouldCall: false, forLogin: true });
    expect(send.headers.location).toBe(LOCATION_ID);
    expect(send.headers.pricelist).toBe(PRICELIST_ID);

    await ctx.auth.verify(TEST_CODE);
    const saved = ctx.session.load()!;
    expect(saved).toMatchObject({ authToken: TEST_TOKEN, email: TEST_EMAIL });
    expect(Object.keys(saved).sort()).toEqual([
      "authToken",
      "createdAt",
      "email",
      "lastVerifiedAt",
      "phone",
    ]);
    expect(await ctx.auth.status()).toMatchObject({ loggedIn: true, phone: "***-***-0123" });
  });

  it("limits how often codes can be requested", async () => {
    const { ctx } = testContext();
    await ctx.auth.start();
    await expect(ctx.auth.start()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("reports a rejected code as invalid input with a hint", async () => {
    const { ctx } = testContext();
    await ctx.auth.start();
    await expect(ctx.auth.verify("000000")).rejects.toMatchObject({
      code: "INVALID_INPUT",
      hint: expect.stringContaining("login_start"),
    });
    expect(ctx.session.load()).toBeNull();
  });

  it("requires a phone number from somewhere", async () => {
    const { ctx } = testContext({ BB_PHONE: "" });
    await expect(ctx.auth.start()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("clears an expired session and asks for a new login", async () => {
    const { ctx, fake } = testContext();
    loginTestSession(ctx);
    fake.sessionValid = false;
    expect(await ctx.auth.status()).toMatchObject({ loggedIn: false, hint: AUTH_HINT });
    expect(ctx.session.load()).toBeNull();
  });

  it("reports not logged in without calling the API when there is no session", async () => {
    const { ctx, fake } = testContext();
    expect((await ctx.auth.status()).loggedIn).toBe(false);
    expect(fake.calls.filter((c) => c.path.startsWith("/user/basket"))).toHaveLength(0);
  });
});

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/session/store.js";

const KEY = "cd".repeat(32);
const SECRET = "TEST_TOKEN_secretvalue";
const session = {
  authToken: SECRET,
  email: "user@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastVerifiedAt: "2026-01-01T00:00:00.000Z",
};

describe("SessionStore", () => {
  it("round-trips a session and never writes it in plain text", () => {
    const dir = mkdtempSync(join(tmpdir(), "brkbowl-sess-"));
    new SessionStore(dir, KEY).save(session);

    const fresh = new SessionStore(dir, KEY);
    expect(fresh.load()).toEqual(session);

    const onDisk = readFileSync(join(dir, "session.enc"), "utf8");
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).not.toContain("user@example.com");
    expect(statSync(join(dir, "session.enc")).mode & 0o777).toBe(0o600);
  });

  it("treats a wrong key as logged out", () => {
    const dir = mkdtempSync(join(tmpdir(), "brkbowl-sess-"));
    new SessionStore(dir, KEY).save(session);
    expect(new SessionStore(dir, "ef".repeat(32)).load()).toBeNull();
  });

  it("clear removes the session", () => {
    const dir = mkdtempSync(join(tmpdir(), "brkbowl-sess-"));
    const store = new SessionStore(dir, KEY);
    store.save(session);
    store.clear();
    expect(new SessionStore(dir, KEY).load()).toBeNull();
  });
});

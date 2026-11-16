import { afterEach, describe, expect, it } from "vitest";
import { clearSecrets, maskPhone, redact, registerSecret } from "../src/util/redact.js";

afterEach(clearSecrets);

describe("redact", () => {
  it("masks phone numbers in several formats, keeping the last four digits", () => {
    expect(redact("call (555) 010-5309 now")).toBe("call ***-***-5309 now");
    expect(redact("555-010-5309")).toBe("***-***-5309");
    expect(redact("+1 555 010 5309")).toBe("***-***-5309");
  });

  it("masks emails", () => {
    expect(redact("mail someone@example.com please")).toBe("mail [email] please");
  });

  it("removes bearer tokens and token fields", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop12345")).toContain("Bearer [redacted]");
    expect(redact('{"authToken":"abc123secret"}')).not.toContain("abc123secret");
  });

  it("removes registered secrets wherever they appear", () => {
    registerSecret("sup3r-secret-value");
    expect(redact("x sup3r-secret-value y sup3r-secret-value")).toBe("x [redacted] y [redacted]");
  });

  it("leaves ordinary text and short numbers alone", () => {
    expect(redact("2 lb carrots at $1.99, 0.5 lb step")).toBe("2 lb carrots at $1.99, 0.5 lb step");
  });

  it("maskPhone shows only the last four digits", () => {
    expect(maskPhone("(555) 010-5309")).toBe("***-***-5309");
  });
});

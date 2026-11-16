const secrets = new Set<string>();

/** Registers an exact value (token, SMS code, password) that must never appear in output. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 4) secrets.add(value);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "***";
}

const PHONE = /(?<![\d.])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d.])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const AUTH_FIELD =
  /("?(?:auth_?token|access_token|refresh_token|password)"?\s*[:=]\s*"?)[^"\s,}]+/gi;

export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out
    .replace(BEARER, "Bearer [redacted]")
    .replace(AUTH_FIELD, "$1[redacted]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, (m) => maskPhone(m));
}

/** Test helper: forget registered secrets. */
export function clearSecrets(): void {
  secrets.clear();
}

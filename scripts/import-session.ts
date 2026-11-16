/* Imports an existing Berkeley Bowl session, so no SMS code is needed.
 *
 * Reads JSON from STDIN (never from arguments, which end up in shell history). Accepts either
 * {"authToken": "...", "email": "..."} or the whole `user` object copied from the website's
 * localStorage. Only the token and email are kept; everything else is discarded.
 *
 *   pbpaste | npm run import-session
 */
import { existsSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { SessionStore } from "../src/session/store.js";

if (existsSync(".env")) process.loadEnvFile(".env");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const config = loadConfig(process.env, "stdio");
const parsed = JSON.parse(await readStdin()) as Record<string, unknown>;
const user = (typeof parsed.user === "object" && parsed.user ? parsed.user : parsed) as Record<
  string,
  unknown
>;
const authToken = typeof user.authToken === "string" ? user.authToken : undefined;
const email = typeof user.email === "string" ? user.email : undefined;
if (!authToken || !email) {
  console.error("Input must contain authToken and email.");
  process.exit(1);
}
const now = new Date().toISOString();
new SessionStore(config.DATA_DIR, config.SESSION_ENCRYPTION_KEY).save({
  authToken,
  email,
  createdAt: now,
  lastVerifiedAt: now,
});
console.log("Session imported and encrypted.");

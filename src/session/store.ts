import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerSecret } from "../util/redact.js";

/** Only what is needed to call the API. The login response holds far more (address, cards); never store it. */
export interface Session {
  authToken: string;
  email: string;
  phone?: string;
  createdAt: string;
  lastVerifiedAt: string;
}

export class SessionStore {
  private cache: Session | null | undefined;
  private readonly key: Buffer;
  private readonly file: string;

  constructor(dataDir: string, hexKey: string) {
    this.key = Buffer.from(hexKey, "hex");
    this.file = join(dataDir, "session.enc");
  }

  load(): Session | null {
    if (this.cache !== undefined) return this.cache;
    try {
      const wrapper = JSON.parse(readFileSync(this.file, "utf8")) as {
        iv: string;
        tag: string;
        data: string;
      };
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(wrapper.iv, "base64"));
      decipher.setAuthTag(Buffer.from(wrapper.tag, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(wrapper.data, "base64")),
        decipher.final(),
      ]);
      this.cache = JSON.parse(plain.toString("utf8")) as Session;
      registerSecret(this.cache.authToken);
    } catch {
      // Missing file, wrong key or corrupt data: treat as logged out.
      this.cache = null;
    }
    return this.cache;
  }

  save(session: Session): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
    const wrapper = {
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(wrapper), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.cache = session;
    registerSecret(session.authToken);
  }

  touch(): void {
    const session = this.load();
    if (session) this.save({ ...session, lastVerifiedAt: new Date().toISOString() });
  }

  clear(): void {
    rmSync(this.file, { force: true });
    this.cache = null;
  }
}

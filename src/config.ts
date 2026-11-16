import { z } from "zod";

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().default("./data"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BASE_URL: z.string().url().optional(),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters").optional(),
  MCP_BEARER_TOKEN: z
    .string()
    .min(24, "MCP_BEARER_TOKEN must be at least 24 characters")
    .optional(),
  SESSION_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "SESSION_ENCRYPTION_KEY must be 64 hex characters"),
  BB_PHONE: z.string().optional(),
  DEFAULT_STORE: z.string().default("west"),
  DEFAULT_PRODUCE_PREFERENCE: z.enum(["conventional", "organic"]).default("conventional"),
  HS_BASE_URL: z.string().url().default("https://user-api.gethomesome.com"),
  // Public key that the Berkeley Bowl website sends to every visitor; not a secret.
  HS_API_KEY: z.string().default("C431BB1B-2A40-4716-BD55-B583E8CB6B2B"),
  CATALOG_TTL_HOURS: z.coerce.number().positive().default(12),
  ALLOWED_REDIRECT_HOSTS: z.string().optional(),
});

export type Config = Omit<z.infer<typeof schema>, "ALLOWED_REDIRECT_HOSTS"> & {
  ALLOWED_REDIRECT_HOSTS: string[];
};

export type Mode = "http" | "stdio";

export function loadConfig(env: NodeJS.ProcessEnv, mode: Mode): Config {
  const parsed = schema.safeParse(
    // Treat empty strings (e.g. from docker-compose defaults) as unset.
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const config: Config = {
    ...parsed.data,
    ALLOWED_REDIRECT_HOSTS: list(parsed.data.ALLOWED_REDIRECT_HOSTS),
  };
  if (mode === "http") {
    const missing: string[] = [];
    if (!config.BASE_URL) missing.push("BASE_URL");
    if (!config.ADMIN_PASSWORD && !config.MCP_BEARER_TOKEN) {
      missing.push("ADMIN_PASSWORD (OAuth) or MCP_BEARER_TOKEN");
    }
    if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
  return config;
}

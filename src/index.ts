import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Mode } from "./config.js";
import { buildContext, type AppContext } from "./context.js";
import { createApp } from "./http/app.js";
import { createServer } from "./server.js";
import { log, setLogLevel } from "./util/log.js";

// Local development convenience; real environment variables always win.
if (process.env.NODE_ENV !== "production" && existsSync(".env")) process.loadEnvFile(".env");

const mode: Mode = process.argv.includes("--stdio") ? "stdio" : "http";

function warmCatalog(ctx: AppContext): void {
  // The catalog is public, so it can download before anyone logs in. Failures are retried on first use.
  ctx.stores
    .resolve()
    .then((store) => ctx.catalog.get(store))
    .catch((error: unknown) => log.warn("Catalog warm-up failed", { error: String(error) }));
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, mode);
  setLogLevel(config.LOG_LEVEL);
  const ctx = buildContext(config);
  warmCatalog(ctx);

  if (mode === "stdio") {
    await createServer(ctx).connect(new StdioServerTransport());
    log.info("brkbowl-mcp running on stdio");
    return;
  }

  const server = createApp(ctx).listen(config.PORT, () => {
    log.info("brkbowl-mcp listening", { port: config.PORT, baseUrl: config.BASE_URL });
  });
  const shutdown = () => {
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

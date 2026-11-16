import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { fail, guard, ok } from "./util.js";

export function registerAuthTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "list_stores",
    {
      title: "List stores",
      description:
        "List Berkeley Bowl stores that offer online shopping. Each store has its own cart. " +
        "Only ask the user which store to use if more than one is available.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const stores = await ctx.stores.list();
      const defaultKey = ctx.stores.getDefaultKey();
      const data = stores.map((s) => ({
        store: s.key,
        name: s.name,
        address: s.address,
        isDefault: s.key === defaultKey || stores.length === 1,
      }));
      return ok(`${stores.length} store(s) available for online shopping.`, data);
    }),
  );

  server.registerTool(
    "auth_status",
    {
      title: "Check Berkeley Bowl login",
      description:
        "Check whether the server is logged in to Berkeley Bowl. Call this before cart operations. " +
        "If not logged in, use login_start then login_verify.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const status = await ctx.auth.status();
      return ok(status.loggedIn ? "Logged in." : "Not logged in.", status);
    }),
  );

  server.registerTool(
    "login_start",
    {
      title: "Send login code",
      description:
        "Send a one-time SMS code to the user's phone to log in to Berkeley Bowl. Then ask the user for the " +
        "code and call login_verify. Uses the server's configured phone number unless one is given.",
      inputSchema: {
        phone: z
          .string()
          .optional()
          .describe("US phone number, e.g. (555) 010-0000. Usually omitted."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(async ({ phone }) => {
      const result = await ctx.auth.start(phone);
      return ok(
        `Code sent to ${result.phone}. Ask the user for the code, then call login_verify.`,
        result,
      );
    }),
  );

  server.registerTool(
    "login_verify",
    {
      title: "Verify login code",
      description: "Complete the Berkeley Bowl login with the SMS code the user received.",
      inputSchema: { code: z.string().describe("The 4-8 digit code from the SMS.") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(async ({ code }) => {
      const result = await ctx.auth.verify(code);
      return ok("Logged in. The session is saved on the server.", result);
    }),
  );

  server.registerTool(
    "logout",
    {
      title: "Log out",
      description: "Delete the saved Berkeley Bowl session from the server.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    guard(async () => ok("Logged out.", ctx.auth.logout())),
  );
}

export { fail };

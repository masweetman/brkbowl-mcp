import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerCartTools } from "./tools/cart.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerMatchingTools } from "./tools/matching.js";

export const WORKFLOW = `Fill my Berkeley Bowl cart from my shopping list. Follow these steps:

1. Preferences. If a skill, memory or earlier message does not already say, ask me: (a) which store — call list_stores and ask only if more than one is available; (b) organic or conventional produce (default conventional). Suggest I save the answers in a skill or memory.
2. Get the unchecked items from my AnyList shopping list with the AnyList tools.
3. Call auth_status. If not logged in: login_start, ask me for the SMS code, then login_verify.
4. Call match_items with the list items, the store and my produce preference.
5. Items with status "remembered" or "suggested" can go straight to the cart. For "needsUserChoice" or preferenceMismatch items, show me the top candidates and ask which one. For "noMatch", tell me.
6. Call remember_match for every choice I confirm.
7. Call add_to_cart once with all chosen items (use each candidate's suggestedCartQuantity; ask if quantityNeedsUserChoice is true).
8. Call get_cart and summarize: items added, the estimated total, and anything not matched.
9. Never check out. Tell me to review the cart and place the order on the Berkeley Bowl website.`;

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: "brkbowl-mcp", version: "0.1.0" },
    {
      instructions:
        "Fills a Berkeley Bowl online grocery cart. Typical flow: list_stores, auth_status (login if needed), " +
        "match_items, add_to_cart, get_cart. Ask the user for store and organic/conventional preference unless " +
        "already known. Never check out; the user places the order.",
    },
  );
  registerAuthTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerMatchingTools(server, ctx);
  registerCartTools(server, ctx);

  server.registerPrompt(
    "fill_cart_from_list",
    {
      title: "Fill my Berkeley Bowl cart from my shopping list",
      description:
        "Step-by-step workflow for turning an AnyList shopping list into a Berkeley Bowl cart.",
      argsSchema: {
        store: z.string().optional().describe("Store short name, e.g. west"),
        producePreference: z.enum(["conventional", "organic"]).optional(),
      },
    },
    ({ store, producePreference }) => {
      const prefs = [
        store ? `Store: ${store}.` : "",
        producePreference ? `Produce preference: ${producePreference}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: prefs ? `${prefs}\n\n${WORKFLOW}` : WORKFLOW },
          },
        ],
      };
    },
  );
  return server;
}

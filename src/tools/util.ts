import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError } from "../errors.js";
import { log } from "../util/log.js";
import { redact } from "../util/redact.js";

export const storeField = z
  .string()
  .optional()
  .describe(
    "Store short name from list_stores (e.g. 'west'). Omit to use the server default. " +
      "Ask the user which store only if list_stores shows more than one available.",
  );

export const preferenceField = z
  .enum(["conventional", "organic"])
  .optional()
  .describe(
    "Produce preference: 'conventional' (server default) or 'organic'. Ask the user unless a skill, " +
      "memory or earlier message already says. Applies to produce only; words in an item's text " +
      "('organic', 'conventional') override it for that item.",
  );

export function ok(summary: string, data: unknown): CallToolResult {
  const text = `${summary}\n\n${JSON.stringify(data, null, 2)}`;
  return { content: [{ type: "text", text: redact(text) }] };
}

export function fail(error: unknown): CallToolResult {
  const known = error instanceof AppError;
  if (!known)
    log.error("Unexpected tool error", {
      error: error instanceof Error ? error.message : String(error),
    });
  const payload = known
    ? {
        error: {
          code: error.code,
          message: error.message,
          ...(error.hint ? { hint: error.hint } : {}),
        },
      }
    : {
        error: { code: "UPSTREAM_ERROR", message: "Unexpected error while handling the request." },
      };
  return {
    isError: true,
    content: [{ type: "text", text: redact(JSON.stringify(payload, null, 2)) }],
  };
}

/** Wraps a handler so thrown errors become structured, redacted tool errors. */
export function guard<A>(handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return fail(error);
    }
  };
}

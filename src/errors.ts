export type ErrorCode =
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "INVALID_INPUT"
  | "CONFIG_ERROR"
  | "STORE_UNAVAILABLE"
  | "RATE_LIMITED";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const AUTH_HINT =
  "Call login_start, ask the user for the SMS code, call login_verify, then retry.";

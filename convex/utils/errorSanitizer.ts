/**
 * Error sanitization utilities for Productboard API responses.
 * Prevents sensitive information from being exposed to the frontend.
 */

// User-friendly error messages mapped by HTTP status code
export const SAFE_ERROR_MAP: Record<number, string> = {
  400: "Invalid request parameters",
  401: "Invalid or expired API token",
  403: "Access denied - check token permissions",
  404: "Resource not found",
  409: "Conflict - resource already exists",
  422: "Invalid data format",
  429: "Rate limit exceeded - please wait and retry",
  500: "Productboard server error",
  502: "Productboard service unavailable",
  503: "Productboard service temporarily unavailable",
  504: "Request timed out",
};

/**
 * Sanitizes API error responses before returning to frontend.
 * Logs full error details server-side for debugging.
 */
export function sanitizeApiError(status: number, rawError: string, context?: string): string {
  // Log full error server-side for debugging (visible in Convex dashboard)
  const logContext = context ? ` [${context}]` : "";
  console.error(`[API Error]${logContext} Status: ${status}, Details: ${rawError}`);

  // Return sanitized message to client
  return SAFE_ERROR_MAP[status] || `Request failed (${status})`;
}

/**
 * Sanitizes caught exceptions before returning to frontend.
 * Logs full error details server-side for debugging.
 */
export function sanitizeCatchError(error: unknown, context?: string): string {
  const message = error instanceof Error ? error.message : String(error);

  // Log full error server-side for debugging
  const logContext = context ? ` [${context}]` : "";
  console.error(`[Catch Error]${logContext} ${message}`);

  // Check for common network errors and return safe messages
  const messageLower = message.toLowerCase();
  if (messageLower.includes("fetch") || messageLower.includes("network")) {
    return "Network error - check your connection";
  }
  if (messageLower.includes("timeout")) {
    return "Request timed out";
  }
  if (messageLower.includes("abort")) {
    return "Request was cancelled";
  }

  return "An unexpected error occurred";
}

// ─── CORS Headers ──────────────────────────────────────────────────────────────
// Shared CORS configuration for all roadmap API endpoints.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Wrap an existing Response with CORS headers.
 * Useful for attaching CORS to `toTextStreamResponse()` which
 * doesn't natively accept custom headers in all cases.
 */
export function withCors(response: Response, extra?: HeadersInit): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  if (extra) {
    const extraHeaders = new Headers(extra);
    extraHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Standard CORS preflight response. */
export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/** JSON response with CORS headers and explicit Content-Type. */
export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/** Error JSON response with CORS headers. */
export function errorResponse(
  error: string,
  details?: string,
  status = 500,
): Response {
  return jsonResponse({ error, ...(details ? { details } : {}) }, status);
}

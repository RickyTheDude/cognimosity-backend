# Cognimosity Backend - Engineering Reference

> **Purpose:** A full engineering reference for porting this backend to Cloudflare Workers or any non-Next.js runtime.  
> Everything here is what has actually been built � quirks, design decisions, naming conventions, and constraints included.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [API Endpoints](#2-api-endpoints)
3. [Two-Phase Loading Design](#3-two-phase-loading-design)
4. [Audience Segmentation System](#4-audience-segmentation-system)
5. [Caching Layer (Upstash Redis)](#5-caching-layer-upstash-redis)
6. [Cache Key Naming Conventions](#6-cache-key-naming-conventions)
7. [Streaming vs. Non-Streaming Responses](#7-streaming-vs-non-streaming-responses)
8. [CORS Handling](#8-cors-handling)
9. [Zod Schemas (Source of Truth)](#9-zod-schemas-source-of-truth)
10. [AI Integration (Vercel AI SDK + Gemini)](#10-ai-integration-vercel-ai-sdk--gemini)
11. [Image Generation Endpoint](#11-image-generation-endpoint)
12. [Environment Variables](#12-environment-variables)
13. [Error Handling Conventions](#13-error-handling-conventions)
14. [Cloudflare Workers Porting Notes](#14-cloudflare-workers-porting-notes)

---

## 1. High-Level Architecture

```
Mobile App (React Native / Flutter)
         |
         v
  +---------------------------------------------+
  |         Next.js 16 App Router Backend        |
  |  (deployed to Vercel, maxDuration = 60s)     |
  |                                              |
  |  POST /api/roadmap          <- Phase 1       |
  |  POST /api/roadmap/module   <- Phase 2       |
  |  POST /api/image            <- Image gen     |
  +---------------------------------------------+
         |                        |
         v                        v
  Upstash Redis              Google Gemini
  (REST-based,           (gemini-3.1-flash-lite-preview
   HTTP only,             via @ai-sdk/google + streamObject)
   no TCP sockets)
                                  |
                                  v
                        Hugging Face Inference API
                        (FLUX.1-schnell, image gen)
```

The backend is a **pure API proxy** � it has no database, no auth, and no user state. It forwards requests to AI providers, caches the results, and streams them back. The frontend `page.tsx` is a stock Next.js placeholder and is never shipped to users.

---

## 2. API Endpoints

### `POST /api/roadmap`
**Phase 1** � Generates or retrieves a cached roadmap skeleton.

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | `string` | YES | The learning topic. Trimmed + lowercased before cache keying. |
| `audience` | `string` | NO | `"school_student"` or `"university_student"` or `"working_professional"`. Defaults to `"school_student"` behavior if omitted. |

**Response on cache miss:** `Content-Type: text/plain; charset=utf-8` � streaming partial JSON chunks.  
**Response on cache hit:** `Content-Type: application/json` � full JSON immediately.

---

### `POST /api/roadmap/module`
**Phase 2** � Generates or retrieves cached rich content for a single module.

| Field | Type | Required | Notes |
|---|---|---|---|
| `roadmapId` | `string` | YES | UUID of the parent roadmap (from Phase 1 response). |
| `moduleId` | `string` | YES | UUID of the specific node (from Phase 1 nodes array). |
| `moduleTitle` | `string` | YES | The node's `label` string. |
| `roadmapTopic` | `string` | YES | The original user prompt / roadmap topic. |
| `context` | `string` | NO | Optional free-text string describing the module's position (e.g., prerequisites). Used inline in the system prompt. |
| `audience` | `string` | NO | Same three values as Phase 1. |

**Response on cache miss:** `Content-Type: text/plain; charset=utf-8` � streaming.  
**Response on cache hit:** `Content-Type: application/json`.

---

### `POST /api/image`
Proxy to Hugging Face FLUX.1-schnell for educational image generation.

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | `string` | YES | A descriptive image generation prompt. |

The backend prepends `"Educational STEM illustration, highly detailed, scientific, high quality: "` to every user query before calling Hugging Face.

**Response:** `{ base64: string }` � raw binary image data from Hugging Face, re-encoded as Base64 and returned as JSON.

> **Quirk:** There is a commented-out `export const preferredRegion = "iad1"` in `image/route.ts`. This was added to bypass ISP-level blocks on Hugging Face in India (Mumbai Vercel region). If you observe Hugging Face timeouts/connection errors from a specific region, pin the worker to a US-East PoP.

---

## 3. Two-Phase Loading Design

The core architectural decision is **lazy content loading**. This was a deliberate cost and UX optimization:

### Phase 1 � Skeleton Only (~2-3s)
- Generates 8-15 roadmap nodes: `id`, `index`, `label`, `description`, `prerequisites[]`.
- The mobile app renders a full interactive graph immediately from this data.
- No module content is generated yet.

### Phase 2 � On-Demand (~3-5s per module)
- Triggered only when a user taps a node.
- Generates a 2000+ word Markdown body, Mermaid diagrams, image queries, key takeaways, and sources for that single module.
- **If the user never opens module 5, module 5 is never generated. Zero API cost.**

### Why this matters for porting:
Both endpoints must support **streaming responses**. The mobile client checks `Content-Type` to determine if it should parse incrementally or as a single JSON blob. This dual-mode behavior is fundamental to the UX.

---

## 4. Audience Segmentation System

Both Phase 1 and Phase 2 have **three distinct system prompts** based on the `audience` field:

| `audience` value | Target | Prompt Focus |
|---|---|---|
| `"school_student"` (default) | Indian school students (CBSE/ICSE/NCERT) | Analogies from Indian contexts (cricket, local festivals), exam-style Q&A, LaTeX math for physics/science subjects |
| `"university_student"` | Undergrad / junior devs | Deep understanding, broad coverage, Interview & Practice Q&A section, Mermaid architecture diagrams |
| `"working_professional"` | Upskilling professionals | Industry focus, "how it works under the hood", scaling, trade-off tables, Real-World Scenarios & Troubleshooting section |

### Key quirk:
The `audience` value flows through the **entire pipeline** � it affects:
1. The system prompt text (different instructions per audience)
2. The Redis **cache key** (`roadmap:v2:${audience}:${prompt}` and `module:${audience}:${roadmapId}:${moduleId}`)

This means the same topic generates three separate cached versions � one per audience. The `:v2:` version prefix in the roadmap cache key was a deliberate migration bump (old `v1` cache is implicitly invalidated by never being read).

---

## 5. Caching Layer (Upstash Redis)

**Why Upstash?** It exposes Redis over a pure HTTP REST API. This was chosen specifically because:
- Vercel serverless functions cannot hold long-lived TCP connections.
- Upstash's `@upstash/redis` package uses `fetch()` internally � no TCP sockets required.

### Client initialization (`redis.ts`)

```typescript
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
```

**Dual env var fallback:** Both `UPSTASH_REDIS_*` and `KV_*` prefixes are supported. The `KV_*` vars are what Vercel's legacy KV integration injects. This was kept for backward compatibility.

### Graceful degradation

Both `cacheGet` and `cacheSet` are wrapped in try/catch and will **silently fail** (warn to console, return null) if:
- Credentials are missing (`redisEnabled = false`)
- The Redis call itself throws

This means the API always works, just without caching. Never crashes due to Redis being down.

### Cache write timing

Cache is written inside the `onFinish` callback of `streamObject`. This means:
- The stream starts immediately to the client.
- Once Gemini finishes generating the full object, it's persisted to Redis in the background.
- Future requests for the same key hit the cache.

### No TTL / expiry

Cache entries have **no expiration** set (`redis.set(key, value)` � no `ex` option). Cached roadmaps and modules persist indefinitely until manually deleted.

---

## 6. Cache Key Naming Conventions

| Resource | Key Format | Example |
|---|---|---|
| Roadmap structure | `roadmap:v2:{audience}:{normalizedPrompt}` | `roadmap:v2:school_student:learn python basics` |
| Module content | `module:{audience}:{roadmapId}:{moduleId}` | `module:university_student:uuid-abc:uuid-xyz` |

**Prompt normalization** for roadmap keys: `prompt.trim().toLowerCase()`. This makes `"Learn Python"`, `"  learn python  "`, and `"learn python"` all resolve to the same cache entry.

Module keys use `roadmapId + moduleId` � both are UUIDs generated by Gemini. The same module title in a different roadmap (different `roadmapId`) gets a separate cache entry.

---

## 7. Streaming vs. Non-Streaming Responses

### Cache Miss � Streaming

Uses Vercel AI SDK's `streamObject`:
```typescript
const result = streamObject({ model, schema, prompt, onFinish });
const streamResponse = result.toTextStreamResponse();
return withCors(streamResponse);
```

- `toTextStreamResponse()` returns `Content-Type: text/plain; charset=utf-8`.
- Data arrives as partial JSON text chunks as Gemini generates tokens.
- The mobile client must handle incremental parsing.

### Cache Hit � Normal JSON

```typescript
return jsonResponse({ source: "cache", data: cached });
```

- Returns `Content-Type: application/json`.
- The `source: "cache"` field is an explicit signal to the mobile app.
- Wrapped data includes a `createdAt: number` (Unix ms timestamp) injected by the server when first written to Redis.

### The CORS wrapping problem

`toTextStreamResponse()` does not accept custom headers natively. The `withCors()` function works around this by cloning the response and injecting CORS headers:

```typescript
export function withCors(response: Response, extra?: HeadersInit): Response {
  const headers = new Headers(response.headers);
  // inject CORS headers into new Headers object...
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

This is the correct Web API pattern for adding headers to a streaming response body � do not use `response.clone()` as that buffers the stream.

---

## 8. CORS Handling

All CORS configuration lives in `app/api/roadmap/cors.ts` and is shared across all routes (including `api/image` which imports from `../roadmap/cors`).

```typescript
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
```

- **Wildcard origin** (`*`) � the API is designed for mobile app consumption, not browser-to-browser.
- Only `POST` and `OPTIONS` methods are allowed. No GET, PUT, DELETE.
- Every route exports an `OPTIONS` handler that returns `204 No Content` with CORS headers.

### Helper functions

| Function | Purpose |
|---|---|
| `optionsResponse()` | 204 response for CORS preflight |
| `jsonResponse(data, status?)` | JSON + CORS response |
| `errorResponse(error, details?, status?)` | Error JSON + CORS response |
| `withCors(response, extra?)` | Attach CORS headers to an existing Response (used for streaming) |

---

## 9. Zod Schemas (Source of Truth)

All request/response shapes are defined in `app/api/roadmap/schemas.ts` using Zod v4. These schemas serve two roles:
1. **Validation** � Zod validates the structure of generated AI output.
2. **Structured generation** � the schema is passed directly to `streamObject` so Gemini is constrained to produce exactly this shape.

### Phase 1: `RoadmapStructureSchema`

```
RoadmapStructure {
  id: string                  // UUID - generated by Gemini
  topic: string               // Echoes the user's prompt
  totalModules: number (int)  // Must match nodes.length
  estimatedHours: number      // Rough total study time
  nodes: RoadmapNode[]        // 8-15 nodes
}

RoadmapNode {
  id: string               // UUID - unique per node
  index: number (int >= 0) // 0-based sequential order
  label: string            // Module title
  description: string      // 1-2 sentence enticing preview
  prerequisites: string[]  // Array of node IDs. Empty [] for root nodes.
}
```

### Phase 2: `ModuleContentSchema`

```
ModuleContent {
  moduleId: string          // Must echo the requested moduleId
  markdownBody: string      // 2000+ word Markdown. Inline Mermaid blocks allowed.
  mermaidDiagrams: [        // 1-3 standalone diagrams (separate from inline)
    { title: string, code: string }
  ]
  imageQueries: [           // 2-4 image generation queries
    {
      alt: string
      query: string         // Detailed FLUX.1-schnell prompt
      placement: "hero" | "inline" | "sidebar"
    }
  ]
  keyTakeaways: string[]    // 3-5 bullet points
  sources: [                // Exactly 3 sources
    { title: string, url: string (valid URL) }
  ]
  estimatedMinutes: number (int)  // Study time for this module
}
```

### TypeScript types

Both schemas export their inferred TypeScript types:
```typescript
export type RoadmapStructure = z.infer<typeof RoadmapStructureSchema>;
export type ModuleContent = z.infer<typeof ModuleContentSchema>;
```

---

## 10. AI Integration (Vercel AI SDK + Gemini)

### Package: `ai` v7 + `@ai-sdk/google` v4

The Vercel AI SDK's `streamObject` function is the only AI call used:

```typescript
import { streamObject } from "ai";
import { google } from "@ai-sdk/google";

const result = streamObject({
  model: google("gemini-3.1-flash-lite-preview"),
  schema: RoadmapStructureSchema,  // or ModuleContentSchema
  prompt: systemPrompt,
  onFinish: async ({ object }) => {
    // runs after full generation completes � used to write to Redis
  },
});
```

### Model used: `gemini-3.1-flash-lite-preview`

Both endpoints use the same model. The `GOOGLE_GENERATIVE_AI_API_KEY` env var is picked up automatically by `@ai-sdk/google` � no explicit credential passing in code.

### `streamObject` vs `generateObject`

`streamObject` is used even when streaming to the client might not be strictly necessary, because it also provides the `onFinish` callback timing � it fires after the full structured object is validated, making it the reliable moment to write to Redis.

### System prompt strategy

Each endpoint constructs a single large `systemPrompt` string passed as the `prompt` field (not split into system/user messages). The prompt contains:
- Role definition
- Topic injection (`${roadmapTopic}`, `${moduleTitle}`)
- Numbered content requirements
- Constraints (word counts, diagram counts, exact structure rules)

The prompt is **not** a simple template � it has extensive natural language instructions that constrain Gemini's output to match the Zod schema precisely.

---

## 11. Image Generation Endpoint

`POST /api/image` is a proxy to **Hugging Face Inference API** using the `FLUX.1-schnell` model from Black Forest Labs.

### Flow:
1. Client sends `{ query: string }`.
2. Backend prepends `"Educational STEM illustration, highly detailed, scientific, high quality: "` to the query.
3. Calls `https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell`.
4. Receives binary image data (`ArrayBuffer`).
5. Converts to Base64 string using `Buffer.from(arrayBuffer).toString("base64")`.
6. Returns `{ base64: string }` as JSON.

### Error handling quirk:
`fetch()` in Node.js hides real network errors behind a `cause` property on the thrown Error. The error handler explicitly unwraps this:

```typescript
if (error instanceof Error && error.cause) {
  const causeMsg = error.cause instanceof Error ? error.cause.message : String(error.cause);
  message += ` (Cause: ${causeMsg})`;
}
```

### `imageQueries` from Phase 2
The `imageQueries` array from `ModuleContentSchema` is designed so the **mobile app** can call `/api/image` per query. The backend generates the descriptive prompts; the client fires the image generation requests on-demand. This is another lazy-loading optimization � images are only fetched when the user scrolls to them.

---

## 12. Environment Variables

| Variable | Used By | Required | Notes |
|---|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` (auto-detected) | YES | Get from aistudio.google.com |
| `UPSTASH_REDIS_REST_URL` | `redis.ts` | YES for caching | Set by Vercel Upstash integration |
| `UPSTASH_REDIS_REST_TOKEN` | `redis.ts` | YES for caching | Set by Vercel Upstash integration |
| `KV_REST_API_URL` | `redis.ts` (fallback) | NO | Legacy Vercel KV alias � falls back automatically |
| `KV_REST_API_TOKEN` | `redis.ts` (fallback) | NO | Legacy Vercel KV alias � falls back automatically |
| `HUGGINGFACE_API_KEY` | `api/image/route.ts` | YES for image gen | HF Inference API token |

If `UPSTASH_REDIS_*` / `KV_*` are absent, Redis is silently disabled � the API still works but caching is a no-op.

---

## 13. Error Handling Conventions

All errors return the same shape:
```json
{ "error": "Human-readable message", "details": "Optional lower-level detail" }
```

All error responses include CORS headers (via `errorResponse()` helper).

| Status | Trigger |
|---|---|
| `400` | Missing/invalid required body fields |
| `500` | Gemini API failure, Hugging Face failure, internal crash |
| Hugging Face status | Passed through directly (e.g., 429, 503) |

Unhandled exceptions in route handlers are caught by the top-level `try/catch` in each `POST` function. There is no global error middleware.

---

## 14. Cloudflare Workers Porting Notes

Key compatibility gaps and decisions you'll need to make:

### Compatible as-is
- All API logic uses standard Web APIs (`Request`, `Response`, `Headers`, `fetch`).
- `@upstash/redis` uses `fetch()` internally � fully Workers-compatible.
- Zod v4 is edge-runtime safe.
- The `cors.ts` helpers use only `Response`, `Headers` � zero Node.js APIs.

### Needs replacement or adaptation

| Current (Next.js) | Workers equivalent |
|---|---|
| `export const maxDuration = 60` (Vercel config) | Cloudflare Workers CPU time limit is ~30ms CPU (wall time is longer). For long AI streams, stream directly � Workers support streaming natively. |
| `import { streamObject } from "ai"` | Vercel AI SDK v7 works in Workers, but test the streaming pipeline. `toTextStreamResponse()` returns a Web API `Response` with a `ReadableStream` body � should be compatible. |
| `Buffer.from(arrayBuffer).toString("base64")` | **Workers do not have `Buffer`.** See fix below � this is the most critical Node.js-specific call. |
| `process.env.*` | Use Workers `env` bindings: `export default { fetch(request, env) { ... } }` |
| Next.js App Router file-based routing | Use Hono or `itty-router` for path-based routing. |
| `@vercel/analytics` (in `package.json`) | Remove or replace with Cloudflare Analytics Engine. |

### The `Buffer` fix (most critical)

```typescript
// BREAKS on Workers � Node.js only
const base64 = Buffer.from(arrayBuffer).toString("base64");

// Workers-compatible replacement
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

### Redis / Caching on Workers
Upstash Redis via `@upstash/redis` works perfectly on Workers (it is HTTP-based). Alternatively, you can use **Cloudflare KV** (for simple key-value) or **D1** (for structured data). The cache key conventions from section 6 can be ported unchanged.

### Module bundling
Workers use Vite or `wrangler` to bundle. Ensure `ai`, `@ai-sdk/google`, `@upstash/redis`, and `zod` are all bundled � none should be treated as external.

### Hono is a natural fit
The existing route structure (`/api/roadmap`, `/api/roadmap/module`, `/api/image`) maps cleanly to Hono routes. CORS handling can be replaced with Hono's built-in CORS middleware, eliminating the `cors.ts` module entirely.

---

*Last updated: July 2026 � reflects the `main` branch.*

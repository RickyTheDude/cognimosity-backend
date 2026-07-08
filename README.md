# Cognimosity Backend

> **API proxy for the Cognimosity-Plan mobile app** — generates AI-powered learning roadmaps with a two-phase, lazy-loading architecture. Streaming JSON, Redis caching, Mermaid diagrams, and image query metadata.

---

## Architecture

```
Mobile App                              Next.js Backend
──────────                              ───────────────

Phase 1: Structure
POST /api/roadmap ──────────────────►  streamObject (Gemini)
  { prompt }                            → Generates skeleton only:
  ← streaming JSON chunks                 IDs, titles, descriptions,
     OR cached JSON (instant)              prerequisites, index

Phase 2: Module Content (on-demand)
POST /api/roadmap/module ───────────►  streamObject (Gemini)
  { roadmapId, moduleId,               → Generates rich content:
    moduleTitle, roadmapTopic }            Markdown body, Mermaid diagrams,
  ← streaming JSON chunks                 image queries, key takeaways,
     OR cached JSON (instant)              sources
```

### How It Works

1. **Phase 1 — Structure**: A `POST /api/roadmap` request generates only the high-level roadmap skeleton (8–15 nodes with titles, descriptions, prerequisites). Takes ~2–3 seconds. The mobile app renders the interactive SVG canvas using its own Bézier layout engine.

2. **Phase 2 — Content**: When a user taps a node, `POST /api/roadmap/module` generates detailed learning material for just that single module — comprehensive Markdown with embedded Mermaid diagrams, image search queries, and sources. Takes ~3–5 seconds.

3. **Caching**: Both endpoints cache results in Redis. Cache hits return normal JSON (`Content-Type: application/json`). Cache misses stream partial JSON chunks (`Content-Type: text/plain; charset=utf-8`). The mobile app checks response headers to decide how to parse.

4. **Cost Efficiency**: Content is only generated when requested. If a user quits after module 1, you never pay for modules 2–15.

---

## Tech Stack

| Layer            | Technology                          |
| ---------------- | ----------------------------------- |
| Framework        | Next.js 16 (App Router, TypeScript) |
| AI Integration   | Vercel AI SDK (`ai`, `@ai-sdk/google`) — `streamObject` |
| Cache / Database | Upstash Redis (`@upstash/redis`)    |
| Validation       | Zod                                 |
| Deployment       | Vercel                              |

---

## Data Schemas

### Phase 1: Roadmap Structure

```typescript
RoadmapStructureSchema {
  id: string              // UUID for the roadmap
  topic: string           // The user's requested subject
  totalModules: number    // Total node count (8–15)
  estimatedHours: number  // Rough total time estimate
  nodes: [
    {
      id: string          // UUID for the node
      index: number       // 0-based position
      label: string       // Module title
      description: string // 1-2 sentence preview
      prerequisites: []   // Array of prerequisite node IDs
    }
  ]
}
```

### Phase 2: Module Content

```typescript
ModuleContentSchema {
  moduleId: string           // Matches the requested module's ID
  markdownBody: string       // Rich Markdown (2000+ words) with inline Mermaid blocks
  mermaidDiagrams: [         // Standalone Mermaid.js diagrams
    { title: string, code: string }
  ]
  imageQueries: [            // For client-side Unsplash/Pexels fetching
    {
      alt: string,           // Alt text
      query: string,         // Highly specific search query
      placement: "hero" | "inline" | "sidebar"
    }
  ]
  keyTakeaways: string[]     // 3-5 bullet summary
  sources: [                 // 3 authoritative resources
    { title: string, url: string }
  ]
  estimatedMinutes: number   // Reading time for this module
}
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** (comes with Node.js)
- A **Google Gemini API key** ([aistudio.google.com](https://aistudio.google.com/))
- An **Upstash Redis database** (available via Vercel Integrations or upstash.com)

### 1. Clone & Install

```bash
git clone https://github.com/RickyTheDude/cognimosity-backend.git
cd cognimosity-backend
npm install
```

### 2. Install Required Dependencies

```bash
npm install ai @ai-sdk/google @upstash/redis zod
```

### 3. Configure Environment Variables

Copy the example env file and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here

UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

> **Note:** When you add Upstash Redis from the Vercel Integrations marketplace, the `UPSTASH_REDIS_*` variables are automatically populated in your Vercel project settings.

### 4. Run Locally

```bash
npm run dev
```

The server starts at `http://localhost:3000`.

---

## API Reference

### `POST /api/roadmap`

Generate or retrieve a cached roadmap **structure** (Phase 1).

#### Request

```bash
curl -X POST http://localhost:3000/api/roadmap \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Learn React from scratch"}'
```

#### Response — Cache Hit (`Content-Type: application/json`)

```json
{
  "source": "cache",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "topic": "Learn React from scratch",
    "totalModules": 12,
    "estimatedHours": 25,
    "nodes": [
      {
        "id": "6ba7b810-...",
        "index": 0,
        "label": "JavaScript Fundamentals",
        "description": "Master the core JS concepts that React builds upon...",
        "prerequisites": []
      }
    ],
    "createdAt": 1720460000000
  }
}
```

#### Response — Cache Miss (`Content-Type: text/plain; charset=utf-8`)

Streams partial JSON chunks as the structure generates (~2–3 seconds).

---

### `POST /api/roadmap/module`

Generate or retrieve cached **content** for a single module (Phase 2).

#### Request

```bash
curl -X POST http://localhost:3000/api/roadmap/module \
  -H "Content-Type: application/json" \
  -d '{
    "roadmapId": "550e8400-e29b-41d4-a716-446655440000",
    "moduleId": "6ba7b810-...",
    "moduleTitle": "JavaScript Fundamentals",
    "roadmapTopic": "Learn React from scratch",
    "context": "This is the first module (index 0) with no prerequisites."
  }'
```

#### Response — Cache Hit (`Content-Type: application/json`)

```json
{
  "source": "cache",
  "data": {
    "moduleId": "6ba7b810-...",
    "markdownBody": "## JavaScript Fundamentals\n\n...",
    "mermaidDiagrams": [
      { "title": "JS Engine Pipeline", "code": "flowchart LR\n  A[Source Code] --> B[Parser]..." }
    ],
    "imageQueries": [
      {
        "alt": "JavaScript engine internals",
        "query": "v8 javascript engine architecture diagram technical illustration",
        "placement": "hero"
      }
    ],
    "keyTakeaways": ["Variables and scoping...", "..."],
    "sources": [
      { "title": "MDN JavaScript Guide", "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide" }
    ],
    "estimatedMinutes": 45,
    "createdAt": 1720460000000
  }
}
```

#### Response — Cache Miss (`Content-Type: text/plain; charset=utf-8`)

Streams partial JSON chunks as the content generates (~3–5 seconds).

---

#### Error Responses

| Status | Body                                                                      | Cause                           |
| ------ | ------------------------------------------------------------------------- | ------------------------------- |
| `400`  | `{ "error": "A non-empty 'prompt' string is required..." }`              | Missing or empty prompt         |
| `400`  | `{ "error": "Missing required fields: 'roadmapId', 'moduleId'..." }`    | Missing module request fields   |
| `500`  | `{ "error": "Roadmap generation failed.", "details": "..." }`           | Gemini API or Redis failure     |
| `500`  | `{ "error": "Module content generation failed.", "details": "..." }`    | Gemini API or Redis failure     |

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub.
2. Import the repository in [vercel.com](https://vercel.com).
3. Add **Upstash Redis** from Vercel Integrations to your project.
4. Add `GOOGLE_GENERATIVE_AI_API_KEY` to your project's Environment Variables.
5. Deploy. ✅

---

## Project Structure

```
cognimosity-backend/
├── app/
│   ├── api/
│   │   └── roadmap/
│   │       ├── route.ts         ← Phase 1: Roadmap structure endpoint
│   │       ├── module/
│   │       │   └── route.ts     ← Phase 2: Module content endpoint
│   │       ├── schemas.ts       ← Shared Zod schemas
│   │       ├── cors.ts          ← CORS utilities
│   │       └── redis.ts         ← Redis client & caching helpers
│   ├── layout.tsx
│   └── page.tsx
├── .env.example                  ← Template for environment variables
├── .env.local                    ← Your secrets (gitignored)
├── .gitignore
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## License

Private — all rights reserved.

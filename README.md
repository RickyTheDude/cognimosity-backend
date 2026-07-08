# Cognimosity Backend

> **API proxy for the Cognimosity-Plan mobile app** — generates AI-powered learning roadmaps with Redis caching for optimal performance.

---

## Architecture

```
Mobile App ──POST /api/roadmap──► Next.js Route Handler
                                       │
                                       ▼
                                  ┌──────────┐
                                  │ Redis KV  │──── cache hit? ──► return cached JSON
                                  └──────────┘
                                       │ cache miss
                                       ▼
                                  ┌──────────┐
                                  │Google AI │──► generateObject (Zod schema)
                                  │ (Gemini) │──► save to Redis
                                  └──────────┘──► return generated JSON
```

### How It Works

1. **Receive** — A `POST` request arrives with a `{ "prompt": "..." }` body.
2. **Normalize** — The prompt is trimmed and lowercased to create a deterministic cache key.
3. **Cache Check** — Vercel KV (Redis) is queried for an existing roadmap.
4. **Cache Hit** — If found, the cached roadmap is returned instantly (`source: "cache"`).
5. **Cache Miss** — The Google (Gemini) API is called via `generateObject` with a strict Zod schema to produce a structured roadmap, which is then cached and returned (`source: "generated"`).

---

## Tech Stack

| Layer            | Technology                        |
| ---------------- | --------------------------------- |
| Framework        | Next.js 16 (App Router, TypeScript) |
| AI Integration   | Vercel AI SDK (`ai`, `@ai-sdk/google`) |
| Cache / Database | Upstash Redis (`@upstash/redis`)  |
| Validation       | Zod                               |
| Deployment       | Vercel                            |

---

## Data Schema

The API enforces a strict Zod schema on all generated roadmaps:

```typescript
RoadmapSchema {
  id: string           // UUID for the roadmap
  topic: string        // The user's requested subject
  nodes: [             // 5–7 sequential learning modules
    {
      id: string       // UUID for the node
      label: string    // Sub-topic title (e.g., "React Hooks")
      material: {
        markdownBody: string   // Rich Markdown learning content
        sources: [             // Exactly 2 authoritative resources
          { title: string, url: string }
        ]
      }
    }
  ]
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

Generate or retrieve a cached learning roadmap.

#### Request

```bash
curl -X POST http://localhost:3000/api/roadmap \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Learn React from scratch"}'
```

#### Response (Cache Hit)

```json
{
  "source": "cache",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "topic": "Learn React from scratch",
    "nodes": [ ... ]
  }
}
```

#### Response (Cache Miss → Generated)

```json
{
  "source": "generated",
  "data": {
    "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "topic": "Learn React from scratch",
    "nodes": [
      {
        "id": "...",
        "label": "JavaScript Fundamentals",
        "material": {
          "markdownBody": "## JavaScript Fundamentals\n\n...",
          "sources": [
            { "title": "MDN JavaScript Guide", "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide" },
            { "title": "JavaScript.info", "url": "https://javascript.info/" }
          ]
        }
      }
    ]
  }
}
```

#### Error Responses

| Status | Body                                                        | Cause                          |
| ------ | ----------------------------------------------------------- | ------------------------------ |
| `400`  | `{ "error": "A non-empty 'prompt' string is required..." }` | Missing or empty prompt        |
| `500`  | `{ "error": "Roadmap generation failed.", "details": "..." }` | Gemini API or Redis failure    |

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
│   │       └── route.ts      ← The single API endpoint
│   ├── layout.tsx
│   └── page.tsx
├── .env.example               ← Template for environment variables
├── .env.local                 ← Your secrets (gitignored)
├── .gitignore
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## License

Private — all rights reserved.

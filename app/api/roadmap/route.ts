import { streamObject } from "ai";
import { google } from "@ai-sdk/google";
import { RoadmapStructureSchema, type RoadmapStructure } from "./schemas";
import { cacheGet, cacheSet } from "./redis";
import { optionsResponse, jsonResponse, errorResponse, withCors } from "./cors";

export const maxDuration = 60; // 60-second max execution time on Vercel

// ─── OPTIONS (CORS Preflight) ──────────────────────────────────────────────────

export async function OPTIONS() {
  return optionsResponse();
}

// ─── POST Handler ──────────────────────────────────────────────────────────────
// Phase 1: Generate ONLY the roadmap structure skeleton.
// Returns streaming JSON on cache miss, normal JSON on cache hit.

export async function POST(request: Request) {
  try {
    // 1. Extract and validate the prompt
    const body = await request.json();
    const { prompt } = body as { prompt?: string };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return errorResponse(
        "A non-empty 'prompt' string is required in the request body.",
        undefined,
        400,
      );
    }

    // 2. Normalize the prompt for a deterministic cache key
    const normalizedPrompt = prompt.trim().toLowerCase();
    const cacheKey = `roadmap:v2:${normalizedPrompt}`;

    // 3. Check Redis for a cached roadmap structure
    type CachedRoadmap = RoadmapStructure & { createdAt: number };
    const cached = await cacheGet<CachedRoadmap>(cacheKey);

    if (cached) {
      // Cache hit — return normal JSON with explicit Content-Type
      return jsonResponse({ source: "cache", data: cached });
    }

    // 4. Cache miss — stream a new roadmap structure via Gemini
    const result = streamObject({
      model: google("gemini-3.1-flash-lite-preview"),
      schema: RoadmapStructureSchema,
      prompt: `You are an expert curriculum designer and course architect focusing on the Indian school education system (CBSE/ICSE/NCERT standards) helping students ace their board exams. Generate a comprehensive learning roadmap structure for the following topic: "${prompt}".

CRITICAL RULES:
- Generate between 8 and 15 sequential learning modules (nodes).
- Each node needs a unique UUID (v4 format), a 0-based index, a clear label, and a 1-2 sentence description that entices a school-going student.
- The "prerequisites" array for each node should contain the IDs of nodes that must be completed first. Foundational modules have an empty prerequisites array.
- Most modules should have 1-2 prerequisites forming a logical dependency graph. Allow some parallel tracks where topics are independent.
- Order modules logically from foundational concepts to advanced topics appropriate for school students.
- The "totalModules" field must match the length of the nodes array.
- Provide a realistic "estimatedHours" for the entire roadmap (typically 10-40 hours depending on topic complexity).
- Make descriptions engaging, specific, and relatable to Indian school contexts (e.g., relating concepts to daily life or exams) — not generic filler.

The user's topic: "${prompt}"`,
      onFinish: async ({ object }) => {
        // Persist the completed structure to Redis for future cache hits
        if (object) {
          const roadmap: CachedRoadmap = {
            ...object,
            createdAt: Date.now(),
          };
          await cacheSet(cacheKey, roadmap);
        }
      },
    });

    // Stream the response with CORS headers
    // toTextStreamResponse sets Content-Type: text/plain; charset=utf-8
    const streamResponse = result.toTextStreamResponse();
    return withCors(streamResponse);
  } catch (error: unknown) {
    console.error("[roadmap] Structure generation failed:", error);

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";

    return errorResponse("Roadmap generation failed.", message);
  }
}

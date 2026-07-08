import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { kv } from "@vercel/kv";
import { z } from "zod";

export const maxDuration = 60; // 60-second max execution time for LLM generation on Vercel

// ─── Data Schema ───────────────────────────────────────────────────────────────

const MaterialSchema = z.object({
  markdownBody: z
    .string()
    .describe(
      "Comprehensive learning material formatted in Markdown. Include code blocks, bullet points, and explanations."
    ),
  sources: z
    .array(
      z.object({
        title: z.string().describe("Title of the resource"),
        url: z.string().url().describe("A real, highly authoritative URL"),
      })
    )
    .describe(
      "Exactly 2 high-quality web resources related to this specific node."
    ),
});

const NodeSchema = z.object({
  id: z.string().describe("A unique UUID for this node."),
  label: z
    .string()
    .describe("The title of the sub-topic, e.g., 'React Hooks'"),
  material: MaterialSchema,
});

const RoadmapSchema = z.object({
  id: z.string().describe("A unique UUID for the entire roadmap."),
  topic: z
    .string()
    .describe("The overarching subject requested by the user."),
  nodes: z
    .array(NodeSchema)
    .describe(
      "An ordered array of exactly 5 to 7 sequential learning modules."
    ),
});

// Infer the TypeScript type from the schema for internal use
type Roadmap = z.infer<typeof RoadmapSchema>;

// ─── CORS Headers ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── OPTIONS (CORS Preflight) ──────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// ─── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    // 1. Extract and validate the prompt from the request body
    const body = await request.json();
    const { prompt } = body as { prompt?: string };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return Response.json(
        { error: "A non-empty 'prompt' string is required in the request body." },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Normalize the prompt to create a deterministic cache key
    const normalizedPrompt = prompt.trim().toLowerCase();
    const cacheKey = `roadmap:${normalizedPrompt}`;

    // 3. Check Redis for a cached roadmap
    let cached: Roadmap | null = null;
    try {
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        cached = await kv.get<Roadmap>(cacheKey);
      }
    } catch (e) {
      console.warn("KV cache get skipped:", e);
    }

    if (cached) {
      return Response.json(
        { source: "cache", data: cached },
        { status: 200, headers: corsHeaders }
      );
    }

    // 4. Cache miss — generate a new roadmap via Google (Gemini)
    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: RoadmapSchema,
      prompt: `You are an expert curriculum designer. Generate a detailed learning roadmap for the following topic: "${prompt}".

The roadmap must contain exactly 5 to 7 sequential learning modules (nodes). Each node must have:
- A unique UUID as its id
- A clear, concise label for the sub-topic
- Comprehensive learning material in Markdown format (markdownBody) with code blocks, bullet points, and thorough explanations
- Exactly 2 high-quality, real, authoritative source URLs with titles

The entire roadmap must also have a unique UUID and a topic field matching the user's request.

Ensure the nodes are ordered logically from foundational concepts to advanced topics.`,
    });

    const roadmap = result.object;

    // 5. Save to Redis for future requests (no expiration — persistent cache)
    try {
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        await kv.set(cacheKey, roadmap);
      }
    } catch (e) {
      console.warn("KV cache set skipped:", e);
    }

    // 6. Return the generated roadmap
    return Response.json(
      { source: "generated", data: roadmap },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    console.error("[roadmap] Generation failed:", error);

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";

    return Response.json(
      { error: "Roadmap generation failed.", details: message },
      { status: 500, headers: corsHeaders }
    );
  }
}

import { streamObject } from "ai";
import { google } from "@ai-sdk/google";
import { ModuleContentSchema, type ModuleContent } from "../schemas";
import { cacheGet, cacheSet } from "../redis";
import {
  optionsResponse,
  jsonResponse,
  errorResponse,
  withCors,
} from "../cors";

export const maxDuration = 60; // 60-second max execution time on Vercel

// ─── Request Body ──────────────────────────────────────────────────────────────

interface ModuleRequest {
  roadmapId: string;
  moduleId: string;
  moduleTitle: string;
  roadmapTopic: string;
  /** Brief context string: what modules come before this one, etc. */
  context?: string;
}

// ─── OPTIONS (CORS Preflight) ──────────────────────────────────────────────────

export async function OPTIONS() {
  return optionsResponse();
}

// ─── POST Handler ──────────────────────────────────────────────────────────────
// Phase 2: Generate rich content for a SINGLE module on-demand.
// Returns streaming JSON on cache miss, normal JSON on cache hit.

export async function POST(request: Request) {
  try {
    // 1. Extract and validate the request body
    const body = (await request.json()) as Partial<ModuleRequest>;

    if (!body.roadmapId || !body.moduleId || !body.moduleTitle || !body.roadmapTopic) {
      return errorResponse(
        "Missing required fields: 'roadmapId', 'moduleId', 'moduleTitle', and 'roadmapTopic' are all required.",
        undefined,
        400,
      );
    }

    const { roadmapId, moduleId, moduleTitle, roadmapTopic, context } = body;

    // 2. Check Redis for cached module content
    const cacheKey = `module:${roadmapId}:${moduleId}`;
    type CachedModule = ModuleContent & { createdAt: number };
    const cached = await cacheGet<CachedModule>(cacheKey);

    if (cached) {
      // Cache hit — return normal JSON with explicit Content-Type
      return jsonResponse({ source: "cache", data: cached });
    }

    // 3. Cache miss — stream rich module content via Gemini
    const contextClause = context
      ? `\n\nCONTEXT WITHIN THE ROADMAP:\n${context}`
      : "";

    const result = streamObject({
      model: google("gemini-2.5-flash"),
      schema: ModuleContentSchema,
      prompt: `You are an expert educator creating in-depth learning material for a single module within a course on "${roadmapTopic}".

MODULE TITLE: "${moduleTitle}"
MODULE ID: "${moduleId}"${contextClause}

CONTENT REQUIREMENTS:
1. **markdownBody** (2000+ words): Write comprehensive, engaging learning material in Markdown.
   - Use clear heading hierarchy (##, ###, ####).
   - Include code examples with syntax highlighting where relevant.
   - Embed Mermaid diagrams inline using fenced code blocks (\`\`\`mermaid ... \`\`\`) to visualize processes, architectures, or flows.
   - Use tables for comparisons, bullet points for key concepts, and blockquotes for important notes.
   - Write like a skilled teacher — explain concepts clearly, use analogies, and build understanding progressively.

2. **mermaidDiagrams** (1-3 diagrams): Create standalone Mermaid.js diagrams that visualize the most important concepts.
   - Use the most appropriate diagram type: flowchart, sequence, class, state, or ER diagram.
   - Each diagram must have a descriptive title.
   - Ensure Mermaid syntax is valid and renders correctly.

3. **imageQueries** (2-4 queries): Provide highly specific image search query strings for Unsplash/Pexels.
   - Be extremely descriptive and precise: "server rack cable management data center blue lighting" NOT "computers".
   - Include technical terms, visual descriptors, colors, and context.
   - Specify appropriate placement: "hero" for the module banner, "inline" for within content, "sidebar" for supplementary visuals.

4. **keyTakeaways** (3-5 bullets): Concise, actionable takeaways the learner should remember.

5. **sources** (exactly 3): Real, authoritative, currently accessible URLs — official documentation, reputable tutorials, or academic resources. No hallucinated links.

6. **estimatedMinutes**: Realistic reading/study time for this module's content.

Generate content that would genuinely teach someone this topic — not surface-level summaries.`,
      onFinish: async ({ object }) => {
        // Persist the completed module content to Redis
        if (object) {
          const moduleData: CachedModule = {
            ...object,
            createdAt: Date.now(),
          };
          await cacheSet(cacheKey, moduleData);
        }
      },
    });

    // Stream the response with CORS headers
    const streamResponse = result.toTextStreamResponse();
    return withCors(streamResponse);
  } catch (error: unknown) {
    console.error("[module] Content generation failed:", error);

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";

    return errorResponse("Module content generation failed.", message);
  }
}

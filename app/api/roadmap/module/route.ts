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
    const body = (await request.json()) as Partial<ModuleRequest & { audience?: string }>;

    if (!body.roadmapId || !body.moduleId || !body.moduleTitle || !body.roadmapTopic) {
      return errorResponse(
        "Missing required fields: 'roadmapId', 'moduleId', 'moduleTitle', and 'roadmapTopic' are all required.",
        undefined,
        400,
      );
    }

    const { roadmapId, moduleId, moduleTitle, roadmapTopic, context, audience } = body;

    // 2. Check Redis for cached module content
    const safeAudience = audience || "default";
    const cacheKey = `module:${safeAudience}:${roadmapId}:${moduleId}`;
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

    let systemPrompt = "";

    if (audience === "university_student") {
      systemPrompt = `You are an expert senior engineering mentor and technical educator, creating in-depth learning material for a single module within a course on "${roadmapTopic}". The target audience is undergrad junior developers or university students.

MODULE TITLE: "${moduleTitle}"
MODULE ID: "${moduleId}"${contextClause}

CONTENT REQUIREMENTS:
1. **markdownBody** (2000+ words): Write comprehensive, clear learning material in Markdown tailored for a junior developer/university student.
   - Use clear heading hierarchy (##, ###, ####).
   - Write in a professional, clear tone emphasizing deep understanding and broad coverage of the topic.
   - Include realistic code examples, best practices, and common pitfalls where relevant.
   - Embed Mermaid diagrams inline using fenced code blocks (\`\`\`mermaid ... \`\`\`) to visualize system architectures, data flows, or logical processes.
   - Format all Math and Physics equations properly using LaTeX math syntax (e.g., $$E = mc^2$$ or $F = ma$) if needed.
   - Use tables for comparisons, bullet points for key concepts, and blockquotes for important notes.
   - At the end of the markdown body, include a dedicated "Interview & Practice Questions" section with 3-5 thought-provoking Q&A pairs typical of technical interviews or practical engineering tasks.

2. **mermaidDiagrams** (1-3 diagrams): Create standalone Mermaid.js diagrams that visualize the most important concepts, architectures, or flows.
   - Use the most appropriate diagram type: flowchart, sequence, class, state, or ER diagram.
   - Each diagram must have a descriptive title.
   - Ensure Mermaid syntax is valid and renders correctly.

3. **imageQueries** (2-4 queries): Provide highly specific image generation prompts for FLUX.1-schnell (a Hugging Face image generation model).
   - Be extremely descriptive and precise. E.g., 'A professional technical diagram of a neural network architecture' or 'A clean, modern illustration of a marketing funnel'.
   - Include art style, technical terms, visual descriptors, colors, lighting, and context.
   - Specify appropriate placement: "hero" for the module banner, "inline" for within content, "sidebar" for supplementary visuals.

4. **keyTakeaways** (3-5 bullets): Concise, actionable takeaways the learner should remember for practical application in their work.

5. **sources** (exactly 3): Real, authoritative, currently accessible URLs — official documentation, reputable technical blogs, or industry standard guides. No hallucinated links.

6. **estimatedMinutes**: Realistic reading/study time for this module's content for a university student.

Generate content that would genuinely teach an undergrad junior developer this topic thoroughly with great clarity and coverage — not surface-level summaries.`;
    } else if (audience === "working_professional") {
      systemPrompt = `You are an expert technical educator and senior engineering mentor, creating highly advanced, focused learning material for a single module within a course on "${roadmapTopic}". The target audience is working professionals upskilling in this domain.

MODULE TITLE: "${moduleTitle}"
MODULE ID: "${moduleId}"${contextClause}

CONTENT REQUIREMENTS:
1. **markdownBody** (2000+ words): Write dense, high-value technical learning material in Markdown.
   - Use clear heading hierarchy (##, ###, ####).
   - Skip trivial basics unless required for context. Focus on "how it works under the hood", edge cases, scaling, and architectural decisions.
   - Include advanced code examples, system design considerations, and performance optimizations.
   - Embed Mermaid diagrams inline using fenced code blocks (\`\`\`mermaid ... \`\`\`) to visualize complex system architectures.
   - Use tables for trade-off comparisons (e.g., Time/Space complexity, Tool A vs Tool B).
   - At the end of the markdown body, include a "Real-World Scenarios & Troubleshooting" section detailing 3-5 common industry challenges and their solutions.

2. **mermaidDiagrams** (1-3 diagrams): Create standalone Mermaid.js diagrams that visualize the most important concepts.
   - Each diagram must have a descriptive title.
   - Ensure Mermaid syntax is valid and renders correctly.

3. **imageQueries** (2-4 queries): Provide highly specific image generation prompts for FLUX.1-schnell.
   - Include art style, technical terms, visual descriptors, colors, lighting, and context.
   - Specify appropriate placement: "hero" for the module banner, "inline" for within content, "sidebar" for supplementary visuals.

4. **keyTakeaways** (3-5 bullets): Highly actionable best practices and "gotchas" for production environments.

5. **sources** (exactly 3): Real, authoritative, currently accessible URLs (e.g., official docs, whitepapers, RFCs, engineering blogs). No hallucinated links.

6. **estimatedMinutes**: Realistic reading/study time for a working professional.

Generate content that directly impacts a professional's day-to-day engineering capabilities.`;
    } else {
      // Default to school_student if audience is 'school_student' or not provided
      systemPrompt = `You are an expert educator focused on the Indian school education system (like CBSE/ICSE/NCERT boards), creating in-depth learning material for a single module within a course on "${roadmapTopic}". The target audience is Indian school-going students.

MODULE TITLE: "${moduleTitle}"
MODULE ID: "${moduleId}"${contextClause}

CONTENT REQUIREMENTS:
1. **markdownBody** (2000+ words): Write comprehensive, engaging learning material in Markdown tailored for Indian school students.
   - Use clear heading hierarchy (##, ###, ####).
   - Write in an encouraging, easy-to-understand tone, using analogies relevant to Indian contexts (e.g., cricket, local festivals, Indian geography, or daily life in India).
   - Format all Math and Physics equations properly using LaTeX math syntax (e.g., $$E = mc^2$$ or $F = ma$). Prepare math and physics equations wherever conceptually necessary to explain the topic rigorously but clearly.
   - Include code examples with syntax highlighting where relevant (if it's a CS topic).
   - Embed Mermaid diagrams inline using fenced code blocks (\`\`\`mermaid ... \`\`\`) to visualize processes, architectures, or flows.
   - Use tables for comparisons, bullet points for key concepts, and blockquotes for important notes.
   - At the end of the markdown body, include a dedicated "Questions & Answers (Exam Prep)" section with 3-5 thought-provoking Q&A pairs (both conceptual and numerical) typical of Indian school exams.

2. **mermaidDiagrams** (1-3 diagrams): Create standalone Mermaid.js diagrams that visualize the most important concepts.
   - Use the most appropriate diagram type: flowchart, sequence, class, state, or ER diagram.
   - Each diagram must have a descriptive title.
   - Ensure Mermaid syntax is valid and renders correctly.

3. **imageQueries** (2-4 queries): Provide highly specific image generation prompts for FLUX.1-schnell (a Hugging Face image generation model).
   - Be extremely descriptive and precise. E.g., "An accurate diagram of magnets with their magnetic field from N to S' or 'A realistic labelled diagram of the Cell'.".
   - Include art style, technical terms, visual descriptors, colors, lighting, and context.
   - Specify appropriate placement: "hero" for the module banner, "inline" for within content, "sidebar" for supplementary visuals.

4. **keyTakeaways** (3-5 bullets): Concise, actionable takeaways the learner should remember for their exams or foundational knowledge.

5. **sources** (exactly 3): Real, authoritative, currently accessible URLs — official documentation, reputable educational portals (e.g., NCERT, Khan Academy, BYJU'S, Vedantu, or reputable international sources). No hallucinated links.

6. **estimatedMinutes**: Realistic reading/study time for this module's content for a school student.

Generate content that would genuinely teach someone this topic thoroughly and help them ace their exams — not surface-level summaries.`;
    }

    const result = streamObject({
      model: google("gemini-3.1-flash-lite-preview"),
      schema: ModuleContentSchema,
      prompt: systemPrompt,
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

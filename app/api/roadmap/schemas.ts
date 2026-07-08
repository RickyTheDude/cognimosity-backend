import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: Roadmap Structure (lightweight skeleton for the SVG canvas)
// ═══════════════════════════════════════════════════════════════════════════════

export const RoadmapNodeSchema = z.object({
  id: z.string().describe("A unique UUID for this node."),
  index: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based sequential position of this module in the learning path.",
    ),
  label: z
    .string()
    .describe(
      "The concise title of this learning module, e.g., 'React Hooks' or 'Neural Network Fundamentals'.",
    ),
  description: z
    .string()
    .describe(
      "A 1-2 sentence preview of what this module covers. Should entice the learner to click.",
    ),
  prerequisites: z
    .array(z.string())
    .describe(
      "Array of node IDs that must be completed before this module. Empty array for the first/foundational modules.",
    ),
});

export const RoadmapStructureSchema = z.object({
  id: z.string().describe("A unique UUID for the entire roadmap."),
  topic: z
    .string()
    .describe("The overarching subject requested by the user."),
  totalModules: z
    .number()
    .int()
    .describe("Total number of modules in this roadmap (should match nodes array length)."),
  estimatedHours: z
    .number()
    .describe(
      "Rough total time estimate in hours to complete the entire roadmap.",
    ),
  nodes: z
    .array(RoadmapNodeSchema)
    .describe(
      "An ordered array of 8 to 15 sequential learning modules forming the course curriculum.",
    ),
});

export type RoadmapStructure = z.infer<typeof RoadmapStructureSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Module Content (rich, on-demand content for a single module)
// ═══════════════════════════════════════════════════════════════════════════════

export const MermaidDiagramSchema = z.object({
  title: z
    .string()
    .describe("A short descriptive title for this diagram, e.g., 'Component Lifecycle Flow'."),
  code: z
    .string()
    .describe(
      "Valid Mermaid.js syntax for the diagram. Use flowchart, sequence, class, or state diagrams as appropriate.",
    ),
});

export const ImageQuerySchema = z.object({
  alt: z
    .string()
    .describe("Descriptive alt text for accessibility and context."),
  query: z
    .string()
    .describe(
      "A highly specific and detailed image generation prompt for Nano Banana Lite. " +
      "Be extremely descriptive about the subject, concept to generate high relevancy images. " +
      "e.g., 'An accurate diagram of magnets with their magnetic field from N to S' or 'A realistic labelled diagram of the Cell'.",
    ),
  placement: z
    .enum(["hero", "inline", "sidebar"])
    .describe(
      "Where this image should appear: 'hero' for a top banner image, " +
      "'inline' for within the content flow, 'sidebar' for supplementary context.",
    ),
});

export const SourceSchema = z.object({
  title: z.string().describe("Title of the resource."),
  url: z
    .string()
    .url()
    .describe(
      "A real, highly authoritative URL — official docs, reputable tutorials, or academic resources.",
    ),
});

export const ModuleContentSchema = z.object({
  moduleId: z
    .string()
    .describe("The UUID of the module this content belongs to (must match the requested moduleId)."),
  markdownBody: z
    .string()
    .describe(
      "Comprehensive learning material in Markdown format (2000+ words). " +
      "Include inline Mermaid code blocks (```mermaid ... ```) for flow charts and diagrams, " +
      "code examples with syntax highlighting, bullet points, tables, and thorough explanations. " +
      "Structure with clear headings (##, ###) for easy navigation.",
    ),
  mermaidDiagrams: z
    .array(MermaidDiagramSchema)
    .describe(
      "1-3 standalone Mermaid.js diagrams that visualize key concepts from this module. " +
      "These are rendered separately from inline diagrams in the markdownBody.",
    ),
  imageQueries: z
    .array(ImageQuerySchema)
    .describe(
      "2-4 highly specific image search queries. The mobile app will use these to fetch " +
      "relevant images from Unsplash or Pexels. Make queries descriptive and precise.",
    ),
  keyTakeaways: z
    .array(z.string())
    .describe(
      "3-5 concise bullet points summarizing the most important concepts from this module.",
    ),
  sources: z
    .array(SourceSchema)
    .describe("Exactly 3 high-quality, real, authoritative web resources related to this module."),
  estimatedMinutes: z
    .number()
    .int()
    .describe("Estimated reading/study time for this module in minutes."),
});

export type ModuleContent = z.infer<typeof ModuleContentSchema>;

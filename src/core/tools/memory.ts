/**
 * Memory tools: search_memory (retrieve from long-term store) and
 * add_memory (explicitly store an important fact).
 */
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

export function registerMemoryTools(registry: { register: (t: Tool) => void }): void {
  registry.register({
    name: "search_memory",
    description:
      "Search the user's long-term memory (facts, preferences, past notes). " +
      "Returns ranked snippets with importance scores. Use to recall context the user expects you to remember.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const query = String(args.query ?? "").trim();
      if (!query) return { ok: false, output: "", error: "query is required" };
      if (!ctx.memory) return { ok: false, output: "", error: "memory store is not available" };
      const limit = typeof args.limit === "number" ? Math.min(Math.max(Math.floor(args.limit), 1), 10) : 5;
      const hits = await ctx.memory.search(query, limit);
      if (hits.length === 0) return { ok: true, output: "(no memory matches)" };
      const out = hits
        .map((h, i) => `${i + 1}. [${h.category}] (importance ${h.importance}/10, ${h.createdAt.toISOString().slice(0, 10)})\n   ${h.content}`)
        .join("\n\n");
      return { ok: true, output: out };
    },
  });

  registry.register({
    name: "add_memory",
    description:
      "Store a durable fact about the user or the project into long-term memory. " +
      "Use for stable preferences, decisions, names, or constraints that future sessions should remember.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact or note to remember" },
        category: { type: "string", description: "e.g. preference | skill | project | personal (default: general)" },
        importance: { type: "number", description: "1-10, higher = more durable (default 5)" },
      },
      required: ["content"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const content = String(args.content ?? "").trim();
      if (!content) return { ok: false, output: "", error: "content is required" };
      if (!ctx.memory) return { ok: false, output: "", error: "memory store is not available" };
      const category = String(args.category ?? "general");
      const importance = typeof args.importance === "number" ? Math.min(Math.max(Math.floor(args.importance), 1), 10) : 5;
      const id = await ctx.memory.add({ content, category, importance });
      return { ok: true, output: `saved memory #${id}` };
    },
  });
}

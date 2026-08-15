/**
 * ask_user tool: suspends the agent loop until the user answers.
 * The interactive channel is injected via ToolContext.ask (CLI: stdin,
 * Web: SSE pending event roundtrip).
 */
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

export function registerAskTool(registry: { register: (t: Tool) => void }): void {
  registry.register({
    name: "ask_user",
    description:
      "Ask the user a question and wait for their answer. " +
      "Use when you need clarification, a decision, or confirmation that only the user can provide.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
      },
      required: ["question"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const question = String(args.question ?? "").trim();
      if (!question) return { ok: false, output: "", error: "question is required" };
      if (!ctx.ask) {
        return { ok: false, output: "", error: "ask_user needs an interactive channel (none available)" };
      }
      const answer = await ctx.ask(question);
      return { ok: true, output: `用户回答: ${answer}` };
    },
  });
}

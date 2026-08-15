/** Current time tool. */
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

export function registerTimeTools(registry: { register: (t: Tool) => void }): void {
  registry.register({
    name: "get_current_time",
    description:
      "Get the current date and time in ISO 8601 format plus the local timezone. " +
      "Use this when the task depends on the current date, day of week, or time.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
      const now = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown";
      return {
        ok: true,
        output: JSON.stringify(
          {
            iso: now.toISOString(),
            local: now.toString(),
            weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
            timezone: tz,
          },
          null,
          2,
        ),
      };
    },
  });
}

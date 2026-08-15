/**
 * fetch_url tool — read a web page's readable content.
 *
 * Primary backend: Jina Reader (https://r.jina.ai/<url>) — free, no API key,
 * returns the page's main text as markdown-ish plain text. Falls back to a
 * local HTML→text extraction if Jina is unreachable.
 */
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_CHARS = 20_000;

async function viaJina(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { "User-Agent": UA, "X-No-Cache": "true" },
    signal,
  });
  if (!res.ok) throw new Error(`Jina Reader HTTP ${res.status}`);
  return res.text();
}

async function localHtmlToText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Strip scripts/styles, then tags; collapse whitespace.
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const text = clean.trim();
  if (!text) throw new Error("page has no extractable text");
  return text;
}

export function registerFetchUrlTool(registry: { register: (t: Tool) => void }): void {
  registry.register({
    name: "fetch_url",
    description:
      "Fetch a web page's readable text content (via Jina Reader, free, no API key). " +
      "Use after web_search to read the full content of a promising result.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full http(s) URL to read" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const url = String(args.url ?? "").trim();
      if (!url) return { ok: false, output: "", error: "url is required" };
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, output: "", error: "url must start with http(s)://" };
      }
      try {
        let text: string;
        try {
          text = await viaJina(url, ctx.signal);
        } catch (jinaErr) {
          text = await localHtmlToText(url, ctx.signal);
        }
        const trimmed = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n… (truncated)" : text;
        return { ok: true, output: trimmed };
      } catch (err) {
        return { ok: false, output: "", error: `fetch_url 失败: ${(err as Error).message}` };
      }
    },
  });
}

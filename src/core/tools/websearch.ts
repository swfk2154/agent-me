/**
 * Web search tool — multi-provider: DuckDuckGo (free, default),
 * Tavily and Brave (API keys). Provider selected via config.searchProvider
 * (with optional searchAPIKey).
 */
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function duckDuckGoSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const titles: string[] = [];
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && urls.length < 8) {
    let href = m[1]!;
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) href = uddg;
    urls.push(href);
    titles.push(stripTags(m[2]!));
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null && snippets.length < 8) {
    snippets.push(stripTags(m[1]!));
  }
  for (let i = 0; i < urls.length; i++) {
    results.push({ title: titles[i] ?? "(no title)", url: urls[i]!, snippet: snippets[i] ?? "" });
  }
  return results;
}

async function tavilySearch(apiKey: string, query: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: max, search_depth: "basic" }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
}

async function braveSearch(apiKey: string, query: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "" }));
}

/** Bing HTML fallback (free, no key) — used when DuckDuckGo is rate-limited. */
async function bingSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal });
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/g;
  const m0 = blockRe.exec(html);
  if (m0) {
    // Parse each result block.
    const liRe = /<li class="b_algo"([\s\S]*?)<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(html)) !== null && results.length < 8) {
      const block = m[1]!;
      const href = /<a[^>]*href="([^"]+)"[^>]*>/.exec(block)?.[1] ?? "";
      const title = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? "");
      const snippet = stripTags(/<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "");
      if (href && title) results.push({ title, url: href, snippet });
    }
  } else {
    // Fallback: grab any <h2><a href> pairs.
    const aRe = /<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/g;
    let m: RegExpExecArray | null;
    while ((m = aRe.exec(html)) !== null && results.length < 8) {
      const url = m[1]!;
      if (url.startsWith("http")) results.push({ title: stripTags(m[2]!), url, snippet: "" });
    }
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .trim();
}

export function registerWebSearchTool(registry: { register: (t: Tool) => void }): void {
  registry.register({
    name: "web_search",
    description:
      "Search the web. Returns up to 8 results with title, URL and snippet. " +
      "Use when the task needs current or external information. " +
      "Backends: DuckDuckGo (default, free) / Tavily / Brave (config.searchProvider).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Max results (default 5, max 8)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const query = String(args.query ?? "").trim();
      if (!query) return { ok: false, output: "", error: "query is required" };
      const max = typeof args.max_results === "number" ? Math.min(Math.max(Math.floor(args.max_results), 1), 8) : 5;
      const provider = ctx.config.searchProvider ?? "duckduckgo";
      const apiKey = ctx.config.searchAPIKey ?? "";
      try {
        let results: SearchResult[];
        switch (provider) {
          case "tavily":
            if (!apiKey) return { ok: false, output: "", error: "tavily 需要 searchAPIKey，请在配置中设置" };
            results = await tavilySearch(apiKey, query, max, ctx.signal);
            break;
          case "brave":
            if (!apiKey) return { ok: false, output: "", error: "brave 需要 searchAPIKey，请在配置中设置" };
            results = await braveSearch(apiKey, query, max, ctx.signal);
            break;
          case "duckduckgo":
          default:
            try {
              results = await duckDuckGoSearch(query, ctx.signal);
            } catch (err) {
              // DDG rate-limits aggressively; fall back to Bing (also free).
              const note = (err as Error).message;
              try {
                results = await bingSearch(query, ctx.signal);
                if (results.length > 0) {
                  return { ok: true, output: `(DuckDuckGo 被限流，已回退 Bing: ${note})\n\n${formatResults(results, max)}` };
                }
              } catch {
                /* fallthrough */
              }
              throw err;
            }
            break;
        }
        const out = formatResults(results, max);
        return { ok: true, output: out || "(no results)" };
      } catch (err) {
        return { ok: false, output: "", error: `web_search(${provider}) 失败: ${(err as Error).message}` };
      }
    },
  });
}

function formatResults(results: SearchResult[], max: number): string {
  return results
    .slice(0, max)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}

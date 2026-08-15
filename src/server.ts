/**
 * Web mode: HTTP server with SSE streaming chat, config/stats APIs and the
 * embedded React frontend (web/dist, built by `npm run build:web`).
 *
 * Chat flow: POST /api/chat opens an SSE stream; agent events are pushed as
 * SSE events. ask_user questions are emitted as {type:"ask"} events and
 * answered via POST /api/answer.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { existsSync, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Runtime } from "./runtime.ts";
import type { AgentEvent } from "./core/agent/loop.ts";
import { BUILTIN_PROVIDERS, saveConfig, type Config } from "./core/config.ts";

interface AskPending {
  question: string;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
}

interface ActiveRun {
  abort: AbortController;
  ask: AskPending | undefined;
}

export interface ServerOptions {
  port: number;
  host?: string;
}

export async function startServer(runtime: Runtime, opts: ServerOptions): Promise<void> {
  const app = new Hono();
  const runs = new Map<string, ActiveRun>();

  // ------------------------------------------------------------------ API --
  app.get("/api/health", (c) => c.json({ ok: true, version: "3.0.0" }));

  app.get("/api/providers", (c) => c.json({ providers: BUILTIN_PROVIDERS }));

  app.get("/api/config", (c) => c.json(runtime.config));

  app.put("/api/config", async (c) => {
    const body = (await c.req.json()) as Partial<Config>;
    Object.assign(runtime.config, body);
    await saveConfig(runtime.paths, runtime.config);
    return c.json({ ok: true, config: runtime.config });
  });

  app.get("/api/stats", (c) => c.json(runtime.store.cacheSummary()));

  app.get("/api/conversations", (c) => c.json({ conversations: runtime.store.listConversations(100) }));

  app.get("/api/conversations/:id", (c) => {
    const id = c.req.param("id");
    const msgs = runtime.store.listMessages(id, 500);
    if (msgs.length === 0 && !runtime.store.listConversations(1000).some((x) => x.id === id)) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ id, messages: msgs });
  });

  app.delete("/api/conversations/:id", (c) => {
    const id = c.req.param("id");
    runs.get(id)?.abort.abort();
    runs.delete(id);
    runtime.store.deleteConversation(id);
    return c.json({ ok: true });
  });

  app.post("/api/chat", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      conversationId?: string;
    };
    const message = (body.message ?? "").trim();
    if (!message) return c.json({ error: "message is required" }, 400);

    const conversationId = body.conversationId ?? runtime.newConversationId();
    runtime.ensureConversation(conversationId);
    const abort = new AbortController();
    let ask: AskPending | undefined;
    runs.set(conversationId, { abort, ask: undefined });

    runtime.store.addMessage(conversationId, { role: "user", content: message });
    runtime.store.touchConversation(conversationId);

    return streamSSE(c, async (stream) => {
      let requestNo = runtime.store.cacheSummary(conversationId).requests;
      let currentAsk: AskPending | undefined;

      const push = (data: unknown) => stream.writeSSE({ data: JSON.stringify(data) });

      try {
        const context = await runtime.newContext(conversationId);
        const agent = await runtime.newAgent(context, {
          onAsk: (question) =>
            new Promise<string>((resolve, reject) => {
              const askId = randomUUID();
              const pending: AskPending = { question, resolve, reject };
              currentAsk = pending;
              runs.set(conversationId, { abort, ask: pending });
              void push({ type: "ask", askId, question });
              // If the client never answers, the request dies with the stream.
            }),
        });

        for await (const ev of agent.run(message, abort.signal)) {
          switch (ev.type) {
            case "delta":
              await push({ type: "delta", text: ev.text });
              break;
            case "thinking":
              await push({ type: "thinking", text: ev.text });
              break;
            case "tool_call":
              await push({ type: "tool_call", tool: ev.tool, args: ev.args });
              break;
            case "tool_result":
              await push({ type: "tool_result", tool: ev.tool, ok: ev.ok, output: ev.output, error: ev.error });
              break;
            case "usage":
              requestNo++;
              runtime.store.addCacheStat(conversationId, requestNo, ev.usage);
              await push({ type: "usage", usage: ev.usage });
              break;
            case "done":
              runtime.store.addMessage(conversationId, { role: "assistant", content: ev.text });
              await push({ type: "done", text: ev.text, conversationId, turns: ev.turns, toolCalls: ev.toolCalls });
              break;
            default:
              break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!abort.signal.aborted) {
          await push({ type: "error", message: msg });
        }
      } finally {
        if (currentAsk) currentAsk.reject(new Error("stream closed"));
        runs.delete(conversationId);
      }
    });
  });

  app.post("/api/answer", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { askId?: string; answer?: string };
    const run = [...runs.entries()].find(([, r]) => r.ask && r.ask.question === body.askId);
    // askId is generated client-side key; match by stored question fallback:
    const entry = [...runs.entries()].find(([, r]) => r.ask && r.ask.resolve);
    if (!body.askId || !entry || !entry[1].ask) {
      return c.json({ error: "no pending ask" }, 404);
    }
    const pending = entry[1].ask;
    entry[1].ask = undefined;
    pending.resolve(body.answer ?? "");
    return c.json({ ok: true });
  });

  app.delete("/api/chat/:id", (c) => {
    const id = c.req.param("id");
    runs.get(id)?.abort.abort();
    runs.delete(id);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ Frontend --
  const dist = path.resolve(runtime.paths.webDist);
  if (!existsSync(dist)) {
    app.get("*", (c) =>
      c.text(
        "Web 前端未构建。请先运行: npm run build:web\n（或使用 CLI: agent-me chat）",
        200,
      ),
    );
  } else {
    app.get("*", async (c) => {
      let p = c.req.path === "/" ? "/index.html" : c.req.path;
      p = decodeURIComponent(p);
      const full = path.join(dist, p);
      if (!full.startsWith(dist)) return c.text("forbidden", 403);
      try {
        const st = await stat(full);
        if (st.isDirectory()) return c.text("not found", 404);
      } catch {
        // SPA fallback → index.html
        return serveIndex(dist);
      }
      const mime = mimeOf(path.extname(full));
      return new Response(createReadStream(full) as unknown as BodyInit, {
        headers: { "Content-Type": mime },
      });
    });
  }

  const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host ?? "127.0.0.1" });
  console.log(`agent-me Web 模式: http://${opts.host ?? "127.0.0.1"}:${opts.port}`);
  console.log(`数据目录: ${runtime.paths.root}`);
  await new Promise<void>((resolve) => {
    server.on?.("close", () => resolve());
  });
}

function serveIndex(dist: string): Response {
  const stream = createReadStream(path.join(dist, "index.html"));
  return new Response(stream as unknown as BodyInit, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".map": "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * End-to-end test: boots the mock LLM server, configures a temp AGENT_ME_HOME
 * pointing at it, then exercises the CLI (tool calling, caching stats).
 *
 * Run:  node --test tests/e2e.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "cli.ts");
const MOCK = path.join(ROOT, "tests", "mock-llm.ts");
const PORT = 19191;

let home; // temp AGENT_ME_HOME
let mock;

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, AGENT_ME_HOME: home };
    const child = spawn("node", [CLI, ...args], { env, stdio: ["pipe", "pipe", "pipe"], cwd: ROOT });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    if (opts.stdin) child.stdin.write(opts.stdin);
    child.stdin.end();
    child.on("close", (code) => resolve({ code, out, err }));
    setTimeout(() => child.kill("SIGKILL"), 30000);
  });
}

before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "agent-me-e2e-"));
  await mkdir(path.join(home, "logs"), { recursive: true });
  mock = spawn("node", [MOCK, String(PORT)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
});

after(async () => {
  mock?.kill();
  await rm(home, { recursive: true, force: true });
});

test("version & help work without config", async () => {
  const v = await run(["version"]);
  assert.equal(v.code, 0);
  assert.match(v.out, /agent-me v3/);
  const h = await run(["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /chat/);
});

test("config set stores encrypted key", async () => {
  const r = await run(["config", "set", "custom"], { stdin: "test-api-key-123\n" });
  assert.equal(r.code, 0);
  assert.match(r.out, /已保存/);
  // secrets.enc exists and does not contain plaintext
  const enc = await readFile(path.join(home, "secrets.enc"), "utf8");
  assert.ok(!enc.includes("test-api-key-123"), "secret must be encrypted");
  // keyfile exists
  await readFile(path.join(home, "keyfile.key"));
});

test("custom provider config points at mock LLM", async () => {
  const cfg = {
    activeProvider: "custom",
    activeModel: "mock-model",
    maxWindowTokens: 32000,
    maxOutputTokens: 1024,
    temperature: 0.7,
    cacheEnabled: true,
    cacheBreakpointTokens: 2048,
    searchProvider: "duckduckgo",
    customBaseUrl: `http://127.0.0.1:${PORT}/v1`,
    customModels: ["mock-model"],
  };
  await writeFile(path.join(home, "config.json"), JSON.stringify(cfg, null, 2));
});

test("ask triggers a tool call and streams", async () => {
  const r = await run(["ask", "现在几点了？", "--output-format", "stream-json"]);
  assert.equal(r.code, 0);
  const lines = r.out.trim().split("\n").map((l) => JSON.parse(l));
  const types = lines.map((l) => l.type);
  assert.ok(types.includes("tool_call"), `expected tool_call, got ${types.join(",")}`);
  assert.ok(types.includes("tool_result"), `expected tool_result, got ${types.join(",")}`);
  assert.ok(types.includes("done"), `expected done, got ${types.join(",")}`);
  const toolCall = lines.find((l) => l.type === "tool_call");
  assert.equal(toolCall.tool, "get_current_time");
  const done = lines.find((l) => l.type === "done");
  assert.ok(done.text.length > 0, "done must carry final text");
});

test("second ask in same conversation hits the simulated cache", async () => {
  // Two asks in the SAME conversation share a message prefix; the mock
  // reports prompt_cache_hit_tokens for the shared prefix, which must show
  // up in the cache stats.
  const first = await run(["ask", "搜索一下 Go 语言", "--output-format", "json"]);
  const id1 = JSON.parse(first.out).conversationId;
  assert.ok(id1, "first ask must return a conversationId");
  const second = await run(["ask", "搜索一下 Rust", "--output-format", "json", "--conversation-id", id1]);
  assert.equal(second.code, 0);
  const s = await run(["stats"]);
  assert.equal(s.code, 0);
  assert.match(s.out, /缓存命中率/);
  const m = s.out.match(/命中率:\s+([\d.]+)%/);
  assert.ok(m, "stats must report a hit rate");
  assert.ok(parseFloat(m[1]) > 0, `expected >0% cache hit rate, got ${m[1]}%`);
});

test("web search tool fails gracefully without network (or hits DDG)", async () => {
  // The mock returns a web_search tool call; execution may succeed (real
  // network) or fail (offline) — either way the agent must produce a done
  // event without crashing.
  const r = await run(["ask", "搜索一下测试", "--output-format", "stream-json"]);
  assert.equal(r.code, 0);
  const types = r.out.trim().split("\n").map((l) => JSON.parse(l).type);
  assert.ok(types.includes("done"), `expected done, got ${types.join(",")}`);
});

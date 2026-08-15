/**
 * Filesystem tools: read_file, write_file, list_directory, grep_files.
 *
 * Path safety: every path is resolved and confined to the workspace root
 * (cwd by default; AGENT_ME_WORKSPACE overrides). Symlinks are resolved so
 * escape attempts fail with a clear error.
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { grepDir } from "./grep.ts";
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

const MAX_FILE_BYTES = 256 * 1024; // 256KB safety cap for read_file
const MAX_GREP_MATCHES = 200;
const MAX_GREP_RESULT_CHARS = 6000;

async function workspaceRoot(ctx: ToolContext): Promise<string> {
  const env = process.env.AGENT_ME_WORKSPACE;
  const root = env ? path.resolve(env) : path.resolve(ctx.cwd);
  await realpath(root).catch(() => root);
  return root;
}

/** Resolve a user-supplied path against the workspace root; throw if escaping. */
async function resolveInWorkspace(raw: string, ctx: ToolContext): Promise<string> {
  const root = await workspaceRoot(ctx);
  const resolved = path.resolve(root, raw);
  const real = await realpath(resolved).catch(() => resolved);
  const rel = path.relative(root, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace root: ${raw}`);
  }
  return real;
}

export function registerFsTools(registry: { register: (t: Tool) => void }): void {
  registry.register({
    name: "read_file",
    description:
      "Read a text file inside the workspace. Returns content with line numbers. " +
      "Limited to 256KB. Use list_directory or grep_files to discover files first.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to workspace root" },
        offset: { type: "number", description: "1-based line offset (optional)" },
        limit: { type: "number", description: "Max lines to return (optional, default all)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const raw = String(args.path ?? "");
      if (!raw) return { ok: false, output: "", error: "path is required" };
      const file = await resolveInWorkspace(raw, ctx);
      const st = await stat(file).catch(() => undefined);
      if (!st?.isFile()) return { ok: false, output: "", error: `not a file: ${raw}` };
      if (st.size > MAX_FILE_BYTES) {
        return { ok: false, output: "", error: `file too large (${st.size} bytes > ${MAX_FILE_BYTES}); use grep_files instead` };
      }
      const content = await readFile(file, "utf8");
      const lines = content.split("\n");
      const offset = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : 1;
      const limit = typeof args.limit === "number" ? Math.max(1, Math.floor(args.limit)) : lines.length;
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = slice.map((l, i) => `${String(offset + i).padStart(4)}: ${l}`).join("\n");
      const truncated = offset - 1 + slice.length < lines.length;
      return { ok: true, output: `${file}\n${numbered}${truncated ? "\n… (truncated)" : ""}` };
    },
  });

  registry.register({
    name: "write_file",
    description:
      "Write text content to a file inside the workspace, creating parent directories. " +
      "Overwrites existing content. Prefer for creating or editing source files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to workspace root" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const raw = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!raw) return { ok: false, output: "", error: "path is required" };
      if (ctx.security && ctx.security.sandbox === "read-only") {
        return { ok: false, output: "", error: "write_file refused: sandbox is read-only" };
      }
      const file = await resolveInWorkspace(raw, ctx);
      await writeFile(file, content, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      return { ok: true, output: `wrote ${bytes} bytes to ${file}` };
    },
  });

  registry.register({
    name: "list_directory",
    description:
      "List directory entries (files and directories) with sizes. " +
      "Hidden entries are skipped. Use to explore the workspace layout.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory relative to workspace root (default: .)" },
        depth: { type: "number", description: "Recursion depth, 0 = flat (default 1)" },
      },
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const raw = String(args.path ?? ".");
      const depth = typeof args.depth === "number" ? Math.max(0, Math.floor(args.depth)) : 1;
      const dir = await resolveInWorkspace(raw, ctx);
      const lines: string[] = [];
      await walk(dir, 0, Math.min(depth, 3), lines);
      return { ok: true, output: lines.join("\n") || "(empty)" };
    },
  });

  registry.register({
    name: "grep_files",
    description:
      "Search file contents inside the workspace for a regex pattern. " +
      "Returns matching lines with file paths and line numbers. Skips .git, node_modules, dist.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for" },
        path: { type: "string", description: "Directory to search (default: workspace root)" },
        include: { type: "string", description: "Glob filter, e.g. '*.ts' (optional)" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return { ok: false, output: "", error: "pattern is required" };
      const root = await workspaceRoot(ctx);
      const dir = args.path ? await resolveInWorkspace(String(args.path), ctx) : root;
      const include = args.include ? String(args.include) : undefined;
      const matches = await grepDir(dir, pattern, {
        include,
        maxMatches: MAX_GREP_MATCHES,
        excludeDirs: [".git", "node_modules", "dist", "build", ".venv", "legacy"],
      });
      const lines = matches.slice(0, MAX_GREP_MATCHES).map((m) => `${m.path}:${m.line}: ${m.text.trim()}`);
      const cut = lines.join("\n");
      return {
        ok: true,
        output: cut.length > MAX_GREP_RESULT_CHARS ? cut.slice(0, MAX_GREP_RESULT_CHARS) + "\n… (truncated)" : cut,
      };
    },
  });
}

async function walk(dir: string, depth: number, maxDepth: number, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    out.push(`<cannot read ${dir}: ${(err as Error).message}>`);
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(`${full}/`);
      if (depth < maxDepth) await walk(full, depth + 1, maxDepth, out);
    } else if (e.isFile() || e.isSymbolicLink()) {
      const st = await stat(full).catch(() => undefined);
      const size = st?.isFile() ? st.size : 0;
      out.push(`${full}  (${size} B)`);
    }
  }
}

/**
 * Directory grep with depth-first traversal, regex matching and exclusions.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  include?: string;
  excludeDirs?: string[];
  maxMatches?: number;
  maxFileBytes?: number;
}

function toRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export async function grepDir(
  root: string,
  pattern: string,
  opts: GrepOptions = {},
): Promise<GrepMatch[]> {
  const re = toRegex(pattern);
  const exclude = new Set(opts.excludeDirs ?? []);
  const includeRe = opts.include ? globToRegex(opts.include) : undefined;
  const maxMatches = opts.maxMatches ?? 500;
  const maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
  const out: GrepMatch[] = [];
  const pending = [root];

  while (pending.length > 0 && out.length < maxMatches) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= maxMatches) break;
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!exclude.has(e.name)) pending.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (includeRe && !includeRe.test(e.name)) continue;
      let content: string;
      try {
        const st = await readFile(full);
        if (st.length > maxFileBytes) continue;
        content = st.toString("utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && out.length < maxMatches; i++) {
        if (re.test(lines[i]!)) {
          out.push({ path: full, line: i + 1, text: lines[i]! });
        }
      }
    }
  }
  return out;
}

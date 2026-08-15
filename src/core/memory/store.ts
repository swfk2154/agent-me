/**
 * MemoryStore: long-term memory over the SQLite store with keyword scoring
 * and time decay (30-day half-life, mirroring agent-me v2.2's design).
 * Embedding-based retrieval can be layered on later; keyword scoring keeps
 * the core dependency-free.
 */
import type { Store, MemoryRow } from "../store/db.ts";

export interface MemoryHit {
  id: number;
  content: string;
  category: string;
  importance: number;
  createdAt: Date;
  score: number;
}

const HALF_LIFE_MS = 30 * 24 * 3600 * 1000;

function tokenize(s: string): Set<string> {
  const lower = s.toLowerCase();
  const latin = lower.match(/[a-z0-9_]+/g) ?? [];
  const cjk = lower.match(/[\u4e00-\u9fff]/g) ?? [];
  return new Set([...latin, ...cjk]);
}

function scoreMemory(m: MemoryRow, queryTokens: Set<string>, now: number): number {
  const contentTokens = tokenize(m.content);
  let overlap = 0;
  for (const t of queryTokens) if (contentTokens.has(t)) overlap++;
  if (overlap === 0) return 0;
  const ageMs = now - m.createdAt;
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return overlap * 2 * (m.importance / 10) * decay;
}

export class MemoryStore {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async add(opts: { content: string; category?: string; importance?: number }): Promise<number> {
    return this.store.addMemory(opts.content, opts.category ?? "general", opts.importance ?? 5);
  }

  async search(query: string, limit = 5): Promise<MemoryHit[]> {
    const tokens = tokenize(query);
    if (tokens.size === 0) return [];
    const all = this.store.listMemories(1000);
    const now = Date.now();
    const scored = all
      .map((m) => ({ m, score: scoreMemory(m, tokens, now) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map(({ m, score }) => ({
      id: m.id,
      content: m.content,
      category: m.category,
      importance: m.importance,
      createdAt: new Date(m.createdAt),
      score,
    }));
  }

  async all(limit = 100): Promise<MemoryRow[]> {
    return this.store.listMemories(limit);
  }
}

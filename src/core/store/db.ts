/**
 * SQLite persistence via Node's built-in `node:sqlite` (zero dependency).
 * Tables: conversations, messages, cache_stats, memories.
 */
import { DatabaseSync } from "node:sqlite";
import type { Message, Usage } from "../llm/types.ts";

export interface ConversationRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRow {
  id: number;
  conversationId: string;
  role: string;
  content: string;
  toolCalls: unknown | null;
  toolCallId: string | null;
  createdAt: number;
}

export interface CacheStatRow {
  conversationId: string;
  requestNo: number;
  promptTokens: number;
  cachedTokens: number;
  creationTokens: number;
  completionTokens: number;
  createdAt: number;
}

export interface MemoryRow {
  id: number;
  content: string;
  category: string;
  importance: number;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS cache_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  request_no INTEGER NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  creation_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_conv ON cache_stats(conversation_id);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  importance INTEGER NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_cat ON memories(category);
`;

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------

  createConversation(id: string, title = "新对话"): void {
    const now = Date.now();
    this.db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, title, now, now);
  }

  listConversations(limit = 50): ConversationRow[] {
    const rows = this.db
      .prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  touchConversation(id: string, title?: string): void {
    if (title !== undefined) {
      this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, Date.now(), id);
    } else {
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(Date.now(), id);
    }
  }

  deleteConversation(id: string): void {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM cache_stats WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  addMessage(convId: string, m: Message): number {
    const res = this.db
      .prepare("INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(convId, m.role, m.content, m.toolCalls ? JSON.stringify(m.toolCalls) : null, m.toolCallId ?? null, Date.now());
    return Number(res.lastInsertRowid);
  }

  listMessages(convId: string, limit = 500): MessageRow[] {
    const rows = this.db
      .prepare("SELECT id, conversation_id, role, content, tool_calls, tool_call_id, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?")
      .all(convId, limit) as Array<Record<string, unknown>>;
    return rows.reverse().map((r) => ({
      id: Number(r.id),
      conversationId: String(r.conversation_id),
      role: String(r.role),
      content: String(r.content),
      toolCalls: r.tool_calls ? (JSON.parse(String(r.tool_calls)) as unknown) : null,
      toolCallId: r.tool_call_id ? String(r.tool_call_id) : null,
      createdAt: Number(r.created_at),
    }));
  }

  toLLMMessages(rows: MessageRow[]): Message[] {
    return rows.map((r) => {
      const m: Message = { role: r.role as Message["role"], content: r.content };
      if (r.toolCalls) m.toolCalls = r.toolCalls as Message["toolCalls"];
      if (r.toolCallId) m.toolCallId = r.toolCallId;
      return m;
    });
  }

  // -------------------------------------------------------------------------
  // Cache stats
  // -------------------------------------------------------------------------

  addCacheStat(convId: string, requestNo: number, usage: Usage): void {
    const cached = Math.max(usage.details.cachedTokens, usage.details.cacheReadTokens);
    this.db
      .prepare("INSERT INTO cache_stats (conversation_id, request_no, prompt_tokens, cached_tokens, creation_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(convId, requestNo, usage.promptTokens, cached, usage.details.cacheCreationTokens, usage.completionTokens, Date.now());
  }

  /** Aggregate cache hit rate across all requests (or one conversation). */
  cacheSummary(convId?: string): { requests: number; promptTokens: number; cachedTokens: number; hitRate: number } {
    const sql = convId
      ? "SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(cached_tokens),0) AS c FROM cache_stats WHERE conversation_id = ?"
      : "SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(cached_tokens),0) AS c FROM cache_stats";
    const row = (convId ? this.db.prepare(sql).get(convId) : this.db.prepare(sql).get()) as Record<string, unknown>;
    const n = Number(row.n);
    const p = Number(row.p);
    const c = Number(row.c);
    return { requests: n, promptTokens: p, cachedTokens: c, hitRate: p > 0 ? c / p : 0 };
  }

  // -------------------------------------------------------------------------
  // Memories
  // -------------------------------------------------------------------------

  addMemory(content: string, category: string, importance: number): number {
    const res = this.db
      .prepare("INSERT INTO memories (content, category, importance, created_at) VALUES (?, ?, ?, ?)")
      .run(content, category, importance, Date.now());
    return Number(res.lastInsertRowid);
  }

  listMemories(limit = 100): MemoryRow[] {
    const rows = this.db
      .prepare("SELECT id, content, category, importance, created_at FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      content: String(r.content),
      category: String(r.category),
      importance: Number(r.importance),
      createdAt: Number(r.created_at),
    }));
  }
}

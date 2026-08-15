import sqlite3, uuid, json, threading
from datetime import datetime
from pathlib import Path
from typing import Optional
from app_config.settings import DB_PATH


class DatabaseService:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._local = threading.local()
        self._init_db()

    @property
    def conn(self):
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(str(self.db_path))
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA foreign_keys=ON")
        return self._local.conn

    def _init_db(self):
        c = self.conn
        c.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '新对话',
                model TEXT DEFAULT 'openai/gpt-4o-mini',
                system_prompt TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                token_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id);
        """)
        self.conn.commit()

    # --- Conversations ---
    def create_conversation(self, title: str = "新对话", model: str = "",
                            system_prompt: str = "") -> dict:
        conv_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        self.conn.execute(
            "INSERT INTO conversations (id,title,model,system_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            (conv_id, title, model, system_prompt, now, now),
        )
        self.conn.commit()
        return self.get_conversation(conv_id)

    def get_conversation(self, conv_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM conversations WHERE id=?", (conv_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["message_count"] = self.conn.execute(
            "SELECT COUNT(*) FROM messages WHERE conv_id=?", (conv_id,)
        ).fetchone()[0]
        return d

    def list_conversations(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT c.*, (SELECT COUNT(*) FROM messages WHERE conv_id=c.id) as message_count "
            "FROM conversations c ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def update_conversation(self, conv_id: str, **kwargs) -> Optional[dict]:
        allowed = {"title", "model", "system_prompt"}
        fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not fields:
            return self.get_conversation(conv_id)
        fields["updated_at"] = datetime.now().isoformat()
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [conv_id]
        self.conn.execute(f"UPDATE conversations SET {sets} WHERE id=?", vals)
        self.conn.commit()
        return self.get_conversation(conv_id)

    def delete_conversation(self, conv_id: str) -> bool:
        cur = self.conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
        self.conn.commit()
        return cur.rowcount > 0

    # --- Messages ---
    def add_message(self, conv_id: str, role: str, content: str, token_count: int = 0) -> dict:
        now = datetime.now().isoformat()
        cur = self.conn.execute(
            "INSERT INTO messages (conv_id,role,content,token_count,created_at) VALUES (?,?,?,?,?)",
            (conv_id, role, content, token_count, now),
        )
        self.conn.execute(
            "UPDATE conversations SET updated_at=? WHERE id=?", (now, conv_id)
        )
        self.conn.commit()
        return {"id": cur.lastrowid, "conv_id": conv_id, "role": role,
                "content": content, "token_count": token_count, "created_at": now}

    def get_messages(self, conv_id: str, limit: int = 200) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM messages WHERE conv_id=? ORDER BY id ASC LIMIT ?",
            (conv_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_last_n_messages(self, conv_id: str, n: int = 20) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM (SELECT * FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT ?) "
            "ORDER BY id ASC", (conv_id, n)
        ).fetchall()
        return [dict(r) for r in rows]

    def update_last_assistant(self, conv_id: str, content: str) -> None:
        row = self.conn.execute(
            "SELECT id FROM messages WHERE conv_id=? AND role='assistant' ORDER BY id DESC LIMIT 1",
            (conv_id,),
        ).fetchone()
        if row:
            self.conn.execute("UPDATE messages SET content=? WHERE id=?", (content, row[0]))
            self.conn.commit()

    # --- Export ---
    def export_conversation(self, conv_id: str) -> Optional[dict]:
        conv = self.get_conversation(conv_id)
        if not conv:
            return None
        messages = self.get_messages(conv_id)
        return {"conversation": conv, "messages": messages}


db = DatabaseService()

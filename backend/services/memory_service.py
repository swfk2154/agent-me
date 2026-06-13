"""记忆服务 v2.1：轻量版兼容
- 有 chromadb + sentence-transformers → 向量语义检索
- 无 chromadb → 降级为 SQLite 简单存储 + 关键词匹配
"""
import json, uuid, datetime, math, re, sqlite3
from collections import defaultdict, deque
from typing import Optional
from app_config.settings import (
    CHROMA_DIR, CHROMA_MEMORY_COLLECTION, CHROMA_FILES_COLLECTION,
    SHORT_TERM_MAX_ROUNDS, LONG_TERM_TOP_K, EMBEDDING_MODEL, PROFILE_PATH,
    MEMORY_DECAY_DAYS, MEMORY_IMPORTANCE_MIN, FACT_EXTRACTION_INTERVAL, SUMMARY_INTERVAL,
    DB_PATH,
)

# ---------- 可选依赖检测 ----------
_CHROMA_AVAILABLE = False
_EMBEDDING_AVAILABLE = False

try:
    import chromadb
    _CHROMA_AVAILABLE = True
except ImportError:
    chromadb = None

try:
    from sentence_transformers import SentenceTransformer
    _EMBEDDING_AVAILABLE = True
except ImportError:
    SentenceTransformer = None


class MemoryService:
    def __init__(self):
        self.short_term: dict[str, deque] = defaultdict(lambda: deque(maxlen=SHORT_TERM_MAX_ROUNDS))
        self._chroma_client = None
        self._memory_collection = None
        self._files_collection = None
        self._model = None
        self._model_load_attempted = False
        self._sqlite_conn = None
        self._init_backend()

    def _init_backend(self):
        """根据可用依赖初始化后端存储"""
        if _CHROMA_AVAILABLE:
            try:
                self._chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
                self._memory_collection = self._chroma_client.get_or_create_collection(CHROMA_MEMORY_COLLECTION)
                self._files_collection = self._chroma_client.get_or_create_collection(CHROMA_FILES_COLLECTION)
            except Exception:
                # ChromaDB 损坏或不可用，回退到 SQLite
                self._chroma_client = None
                self._memory_collection = None
                self._files_collection = None
        if not _CHROMA_AVAILABLE or self._memory_collection is None:
            self._sqlite_conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            self._sqlite_conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    importance INTEGER DEFAULT 5,
                    timestamp TEXT,
                    type TEXT DEFAULT 'general',
                    category TEXT,
                    conv_id TEXT
                )
            """)
            self._sqlite_conn.execute("""
                CREATE TABLE IF NOT EXISTS file_chunks (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    file_id TEXT,
                    filename TEXT,
                    file_type TEXT,
                    chunk_index INTEGER DEFAULT 0
                )
            """)
            self._sqlite_conn.commit()

    @property
    def embedding_model(self):
        if self._model is None and not self._model_load_attempted and _EMBEDDING_AVAILABLE:
            self._model_load_attempted = True
            try:
                self._model = SentenceTransformer(EMBEDDING_MODEL)
            except Exception:
                self._model = None
        return self._model

    def _encode(self, text: str) -> Optional[list]:
        if self.embedding_model:
            return self.embedding_model.encode(text).tolist()
        return None

    # === 短期记忆（始终可用） ===
    def add_to_short_term(self, conv_id, role, content):
        self.short_term[conv_id].append({"role": role, "content": content})

    def get_short_term(self, conv_id):
        return list(self.short_term.get(conv_id, []))

    def clear_short_term(self, conv_id):
        self.short_term.pop(conv_id, None)

    def get_message_count(self, conv_id) -> int:
        return len(self.short_term.get(conv_id, []))

    # === 长期记忆 ===
    def store_memory(self, text, metadata=None, importance: int = 5):
        if metadata is None:
            metadata = {}
        if importance < MEMORY_IMPORTANCE_MIN:
            return
        now = datetime.datetime.now().isoformat()

        if self._memory_collection is not None:
            # ChromaDB 向量存储
            emb = self._encode(text)
            if emb is None:
                return
            metadata.update({
                "timestamp": now,
                "importance": importance,
                "type": metadata.get("type", "general"),
            })
            self._memory_collection.add(
                ids=[str(uuid.uuid4())],
                embeddings=[emb],
                documents=[text],
                metadatas=[metadata]
            )
        elif self._sqlite_conn is not None:
            # SQLite 回退存储
            self._sqlite_conn.execute(
                "INSERT INTO memories (id, content, importance, timestamp, type, category, conv_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), text, importance, now,
                 metadata.get("type", "general"),
                 metadata.get("category", ""),
                 metadata.get("conv_id", ""))
            )
            self._sqlite_conn.commit()

    def retrieve_memories(self, query, k=LONG_TERM_TOP_K):
        if self._memory_collection is not None:
            return self._retrieve_vector(query, k)
        elif self._sqlite_conn is not None:
            return self._retrieve_sqlite(query, k)
        return []

    def _retrieve_vector(self, query, k):
        """ChromaDB 向量检索"""
        if self._memory_collection.count() == 0:
            return []
        emb = self._encode(query)
        if emb is None:
            return []
        results = self._memory_collection.query(query_embeddings=[emb], n_results=min(k * 3, 50))
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        scored = []
        now = datetime.datetime.now()
        for doc, meta, dist in zip(docs, metas, distances):
            if not doc:
                continue
            relevance = max(0, 1 - dist) if dist is not None else 0.5
            importance = meta.get("importance", 5) / 10.0
            try:
                ts = datetime.datetime.fromisoformat(meta.get("timestamp", now.isoformat()))
                days_old = (now - ts).total_seconds() / 86400
                decay = math.exp(-days_old / MEMORY_DECAY_DAYS)
            except Exception:
                decay = 1.0
            score = relevance * importance * decay
            scored.append({"content": doc, "metadata": meta, "score": score})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return [s["content"] for s in scored[:k]]

    def _retrieve_sqlite(self, query, k):
        """SQLite 关键词回退检索"""
        if not self._sqlite_conn:
            return []
        # 提取查询关键词（简单分词）
        keywords = [w for w in re.split(r"[\s,。！？.!?]", query) if len(w) >= 2]
        if not keywords:
            return []
        # 按关键词匹配 + 重要性 + 时间排序
        cursor = self._sqlite_conn.execute(
            "SELECT content, importance, timestamp FROM memories ORDER BY timestamp DESC LIMIT 200"
        )
        rows = cursor.fetchall()
        scored = []
        now = datetime.datetime.now()
        for content, importance, ts_str in rows:
            # 关键词匹配分数
            match_count = sum(1 for kw in keywords if kw.lower() in content.lower())
            if match_count == 0:
                continue
            relevance = min(1.0, match_count / len(keywords))
            importance_norm = importance / 10.0
            try:
                ts = datetime.datetime.fromisoformat(ts_str)
                days_old = (now - ts).total_seconds() / 86400
                decay = math.exp(-days_old / MEMORY_DECAY_DAYS)
            except Exception:
                decay = 1.0
            score = relevance * importance_norm * decay
            scored.append({"content": content, "score": score})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return [s["content"] for s in scored[:k]]

    def search_memories(self, query, k=20):
        """搜索记忆，返回完整信息"""
        if self._memory_collection is not None:
            if self._memory_collection.count() == 0:
                return []
            emb = self._encode(query)
            if emb is None:
                return []
            results = self._memory_collection.query(query_embeddings=[emb], n_results=k)
            docs = results.get("documents", [[]])[0]
            metas = results.get("metadatas", [[]])[0]
            return [{"content": d, "metadata": m} for d, m in zip(docs, metas) if d]
        elif self._sqlite_conn is not None:
            # SQLite 回退：简单关键词匹配
            keywords = [w for w in re.split(r"[\s,。！？.!?]", query) if len(w) >= 2]
            if not keywords:
                return []
            cursor = self._sqlite_conn.execute(
                "SELECT content, importance, timestamp, type, category FROM memories ORDER BY timestamp DESC LIMIT ?",
                (k * 3,)
            )
            rows = cursor.fetchall()
            results = []
            for content, importance, ts, type_, category in rows:
                match_count = sum(1 for kw in keywords if kw.lower() in content.lower())
                if match_count > 0:
                    results.append({
                        "content": content,
                        "metadata": {"importance": importance, "timestamp": ts, "type": type_, "category": category}
                    })
            return results[:k]
        return []

    def cleanup_old_memories(self, max_age_days: int = 90, min_importance: int = 3):
        if self._memory_collection is not None:
            try:
                all_data = self._memory_collection.get()
                ids = all_data.get("ids", [])
                metas = all_data.get("metadatas", [])
                now = datetime.datetime.now()
                to_delete = []
                for mid, meta in zip(ids, metas):
                    try:
                        ts = datetime.datetime.fromisoformat(meta.get("timestamp", now.isoformat()))
                        days_old = (now - ts).total_seconds() / 86400
                        importance = meta.get("importance", 5)
                        if days_old > max_age_days and importance < min_importance:
                            to_delete.append(mid)
                    except Exception:
                        continue
                if to_delete:
                    self._memory_collection.delete(ids=to_delete)
                return len(to_delete)
            except Exception:
                return 0
        elif self._sqlite_conn is not None:
            cutoff = (datetime.datetime.now() - datetime.timedelta(days=max_age_days)).isoformat()
            cursor = self._sqlite_conn.execute(
                "DELETE FROM memories WHERE timestamp < ? AND importance < ?",
                (cutoff, min_importance)
            )
            self._sqlite_conn.commit()
            return cursor.rowcount
        return 0

    def clear_long_term(self):
        if self._memory_collection is not None:
            self._chroma_client.delete_collection(CHROMA_MEMORY_COLLECTION)
            self._memory_collection = self._chroma_client.create_collection(CHROMA_MEMORY_COLLECTION)
        elif self._sqlite_conn is not None:
            self._sqlite_conn.execute("DELETE FROM memories")
            self._sqlite_conn.commit()

    # === 结构化用户画像（始终可用，纯 JSON 文件） ===
    def get_profile(self):
        if not PROFILE_PATH.exists():
            return {"name": "", "preferences": [], "skills": [], "habits": [], "facts": []}
        data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        for key in ["skills", "habits", "facts"]:
            if key not in data:
                data[key] = []
        return data

    def update_profile(self, updates):
        profile = self.get_profile()
        for key, value in updates.items():
            if key in ("preferences", "skills", "habits", "facts") and isinstance(value, list):
                existing = set(profile.get(key, []))
                existing.update(value)
                profile[key] = list(existing)
            else:
                profile[key] = value
        PROFILE_PATH.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

    def merge_facts_into_profile(self, facts: list[dict]):
        if not facts:
            return
        profile = self.get_profile()
        for fact_item in facts:
            fact_text = fact_item.get("fact", "").strip()
            category = fact_item.get("category", "其他")
            importance = fact_item.get("importance", 5)
            if not fact_text:
                continue

            if category == "身份":
                if "name" not in profile or not profile["name"]:
                    if "叫" in fact_text or "是" in fact_text:
                        profile["name"] = fact_text.split("叫")[-1].split("是")[-1].strip("。， ")
                profile.setdefault("facts", []).append(fact_text)
            elif category == "技能偏好":
                profile.setdefault("skills", []).append(fact_text)
            elif category == "工作习惯":
                profile.setdefault("habits", []).append(fact_text)
            elif category == "个人喜好":
                profile.setdefault("preferences", []).append(fact_text)
            else:
                profile.setdefault("facts", []).append(fact_text)

            if importance >= 7:
                self.store_memory(
                    f"[用户画像] {fact_text}",
                    metadata={"type": "profile", "category": category},
                    importance=importance
                )

        for key in ("preferences", "skills", "habits", "facts"):
            if key in profile:
                seen = set()
                unique = []
                for item in profile[key]:
                    if item not in seen:
                        seen.add(item)
                        unique.append(item)
                profile[key] = unique

        PROFILE_PATH.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

    # === 会话摘要 ===
    def store_summary(self, conv_id: str, summary: str):
        if summary:
            self.store_memory(
                f"[对话摘要] {summary}",
                metadata={"type": "summary", "conv_id": conv_id},
                importance=6
            )

    # === 文件记忆 ===
    def store_file_chunks(self, chunks, metadata):
        if self._files_collection is not None:
            embs = [self._encode(c) for c in chunks]
            if any(e is None for e in embs):
                return
            self._files_collection.add(
                ids=[str(uuid.uuid4()) for _ in chunks],
                embeddings=embs,
                documents=chunks,
                metadatas=[{**metadata, "chunk_index": i} for i in range(len(chunks))]
            )
        elif self._sqlite_conn is not None:
            for i, chunk in enumerate(chunks):
                self._sqlite_conn.execute(
                    "INSERT INTO file_chunks (id, content, file_id, filename, file_type, chunk_index) VALUES (?, ?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), chunk, metadata.get("file_id", ""),
                     metadata.get("filename", ""), metadata.get("file_type", ""), i)
                )
            self._sqlite_conn.commit()

    def retrieve_file_chunks(self, query, k=3):
        if self._files_collection is not None:
            if self._files_collection.count() == 0:
                return []
            emb = self._encode(query)
            if emb is None:
                return []
            results = self._files_collection.query(query_embeddings=[emb], n_results=k)
            return results.get("documents", [[]])[0]
        elif self._sqlite_conn is not None:
            keywords = [w for w in re.split(r"[\s,。！？.!?]", query) if len(w) >= 2]
            if not keywords:
                return []
            cursor = self._sqlite_conn.execute(
                "SELECT content FROM file_chunks ORDER BY chunk_index LIMIT 200"
            )
            rows = cursor.fetchall()
            scored = []
            for (content,) in rows:
                match_count = sum(1 for kw in keywords if kw.lower() in content.lower())
                if match_count > 0:
                    scored.append({"content": content, "score": match_count})
            scored.sort(key=lambda x: x["score"], reverse=True)
            return [s["content"] for s in scored[:k]]
        return []

    def list_files(self):
        if self._files_collection is not None:
            if self._files_collection.count() == 0:
                return []
            results = self._files_collection.get()
            metas = results.get("metadatas", [])
            seen, files = set(), []
            for m in metas:
                fid = m.get("file_id", "")
                if fid and fid not in seen:
                    seen.add(fid)
                    files.append({
                        "id": fid,
                        "filename": m.get("filename", ""),
                        "file_type": m.get("file_type", ""),
                        "chunk_count": sum(1 for x in metas if x.get("file_id") == fid)
                    })
            return files
        elif self._sqlite_conn is not None:
            cursor = self._sqlite_conn.execute(
                "SELECT file_id, filename, file_type, COUNT(*) as chunk_count FROM file_chunks GROUP BY file_id"
            )
            return [
                {"id": row[0], "filename": row[1], "file_type": row[2], "chunk_count": row[3]}
                for row in cursor.fetchall()
            ]
        return []


memory_service = MemoryService()

"""记忆服务 v2.0：短期(会话缓存) + 长期(ChromaDB+评分衰减) + 结构化画像 + 自动事实提取 + 会话摘要"""
import json, uuid, datetime, math
from collections import defaultdict, deque
from typing import Optional
import chromadb
from app_config.settings import (
    CHROMA_DIR, CHROMA_MEMORY_COLLECTION, CHROMA_FILES_COLLECTION,
    SHORT_TERM_MAX_ROUNDS, LONG_TERM_TOP_K, EMBEDDING_MODEL, PROFILE_PATH,
    MEMORY_DECAY_DAYS, MEMORY_IMPORTANCE_MIN, FACT_EXTRACTION_INTERVAL, SUMMARY_INTERVAL,
)


class MemoryService:
    def __init__(self):
        self.short_term: dict[str, deque] = defaultdict(lambda: deque(maxlen=SHORT_TERM_MAX_ROUNDS))
        self.chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        self.memory_collection = self.chroma_client.get_or_create_collection(CHROMA_MEMORY_COLLECTION)
        self.files_collection = self.chroma_client.get_or_create_collection(CHROMA_FILES_COLLECTION)
        self._model = None
        self._model_load_attempted = False

    @property
    def embedding_model(self):
        if self._model is None and not self._model_load_attempted:
            self._model_load_attempted = True
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(EMBEDDING_MODEL)
            except Exception:
                self._model = None
        return self._model

    def _encode(self, text: str) -> list:
        if self.embedding_model:
            return self.embedding_model.encode(text).tolist()
        return None

    # === 短期记忆 ===
    def add_to_short_term(self, conv_id, role, content):
        self.short_term[conv_id].append({"role": role, "content": content})

    def get_short_term(self, conv_id):
        return list(self.short_term.get(conv_id, []))

    def clear_short_term(self, conv_id):
        self.short_term.pop(conv_id, None)

    def get_message_count(self, conv_id) -> int:
        return len(self.short_term.get(conv_id, []))

    # === 长期记忆（带重要性+时间衰减） ===
    def store_memory(self, text, metadata=None, importance: int = 5):
        """存储记忆，带重要性评分（1-10）和时间戳"""
        if metadata is None: metadata = {}
        if importance < MEMORY_IMPORTANCE_MIN:
            return  # 低重要性记忆不存入长期记忆
        emb = self._encode(text)
        if emb is None: return
        now = datetime.datetime.now().isoformat()
        metadata.update({
            "timestamp": now,
            "importance": importance,
            "type": metadata.get("type", "general"),
        })
        self.memory_collection.add(
            ids=[str(uuid.uuid4())],
            embeddings=[emb],
            documents=[text],
            metadatas=[metadata]
        )

    def retrieve_memories(self, query, k=LONG_TERM_TOP_K):
        """检索记忆，返回按相关性*重要性*衰减因子排序的结果"""
        if self.memory_collection.count() == 0:
            return []
        emb = self._encode(query)
        if emb is None:
            return []
        # 检索更多候选，然后按综合分数排序
        results = self.memory_collection.query(query_embeddings=[emb], n_results=min(k * 3, 50))
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        scored = []
        now = datetime.datetime.now()
        for doc, meta, dist in zip(docs, metas, distances):
            if not doc:
                continue
            # 相关性分数（ChromaDB 距离越小越相关，转为 0-1）
            relevance = max(0, 1 - dist) if dist is not None else 0.5
            # 重要性
            importance = meta.get("importance", 5) / 10.0
            # 时间衰减
            try:
                ts = datetime.datetime.fromisoformat(meta.get("timestamp", now.isoformat()))
                days_old = (now - ts).total_seconds() / 86400
                decay = math.exp(-days_old / MEMORY_DECAY_DAYS)
            except Exception:
                decay = 1.0
            # 综合分数
            score = relevance * importance * decay
            scored.append({"content": doc, "metadata": meta, "score": score})

        # 按分数降序，取前 k
        scored.sort(key=lambda x: x["score"], reverse=True)
        return [s["content"] for s in scored[:k]]

    def search_memories(self, query, k=20):
        """搜索记忆，返回完整信息（含分数）"""
        if self.memory_collection.count() == 0:
            return []
        emb = self._encode(query)
        if emb is None:
            return []
        results = self.memory_collection.query(query_embeddings=[emb], n_results=k)
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        return [{"content": d, "metadata": m} for d, m in zip(docs, metas) if d]

    def cleanup_old_memories(self, max_age_days: int = 90, min_importance: int = 3):
        """清理过期的低重要性记忆"""
        try:
            all_data = self.memory_collection.get()
            ids = all_data.get("ids", [])
            metas = all_data.get("metadatas", [])
            now = datetime.datetime.now()
            to_delete = []

            for mid, meta in zip(ids, metas):
                try:
                    ts = datetime.datetime.fromisoformat(meta.get("timestamp", now.isoformat()))
                    days_old = (now - ts).total_seconds() / 86400
                    importance = meta.get("importance", 5)
                    # 删除条件：超期且重要性低
                    if days_old > max_age_days and importance < min_importance:
                        to_delete.append(mid)
                except Exception:
                    continue

            if to_delete:
                self.memory_collection.delete(ids=to_delete)
            return len(to_delete)
        except Exception:
            return 0

    def clear_long_term(self):
        self.chroma_client.delete_collection(CHROMA_MEMORY_COLLECTION)
        self.memory_collection = self.chroma_client.create_collection(CHROMA_MEMORY_COLLECTION)

    # === 结构化用户画像 ===
    def get_profile(self):
        """获取结构化用户画像"""
        if not PROFILE_PATH.exists():
            return {
                "name": "",
                "preferences": [],
                "skills": [],
                "habits": [],
                "facts": [],
            }
        data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        # 确保新字段存在
        for key in ["skills", "habits", "facts"]:
            if key not in data:
                data[key] = []
        return data

    def update_profile(self, updates):
        """更新用户画像，自动合并列表字段"""
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
        """将提取的事实合并到用户画像"""
        if not facts:
            return
        profile = self.get_profile()
        for fact_item in facts:
            fact_text = fact_item.get("fact", "").strip()
            category = fact_item.get("category", "其他")
            importance = fact_item.get("importance", 5)
            if not fact_text:
                continue

            # 根据 category 分类存储
            if category == "身份":
                if "name" not in profile or not profile["name"]:
                    # 尝试从事实中提取名字
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

            # 同时将高重要性事实存入长期记忆
            if importance >= 7:
                self.store_memory(
                    f"[用户画像] {fact_text}",
                    metadata={"type": "profile", "category": category},
                    importance=importance
                )

        # 去重
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
        """存储对话摘要"""
        if summary:
            self.store_memory(
                f"[对话摘要] {summary}",
                metadata={"type": "summary", "conv_id": conv_id},
                importance=6
            )

    # === 文件记忆 ===
    def store_file_chunks(self, chunks, metadata):
        embs = [self._encode(c) for c in chunks]
        if any(e is None for e in embs): return
        self.files_collection.add(
            ids=[str(uuid.uuid4()) for _ in chunks], embeddings=embs, documents=chunks,
            metadatas=[{**metadata, "chunk_index": i} for i in range(len(chunks))])

    def retrieve_file_chunks(self, query, k=3):
        if self.files_collection.count() == 0: return []
        emb = self._encode(query)
        if emb is None: return []
        results = self.files_collection.query(query_embeddings=[emb], n_results=k)
        return results.get("documents", [[]])[0]

    def list_files(self):
        if self.files_collection.count() == 0: return []
        results = self.files_collection.get()
        metas = results.get("metadatas", [])
        seen, files = set(), []
        for m in metas:
            fid = m.get("file_id", "")
            if fid and fid not in seen:
                seen.add(fid)
                files.append({"id": fid, "filename": m.get("filename", ""),
                              "file_type": m.get("file_type", ""),
                              "chunk_count": sum(1 for x in metas if x.get("file_id") == fid)})
        return files


memory_service = MemoryService()

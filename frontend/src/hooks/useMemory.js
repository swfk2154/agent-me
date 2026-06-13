import { useState, useCallback } from "react";
import { api } from "../utils/api";

export function useMemory() {
  const [memories, setMemories] = useState([]);
  const search = useCallback(async (q) => {
    const results = await api.searchMemories(q);
    setMemories(results);
  }, []);
  const clear = useCallback(async () => {
    await api.clearMemory();
    setMemories([]);
  }, []);
  return { memories, search, clear };
}

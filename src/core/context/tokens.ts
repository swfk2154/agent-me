/**
 * Approximate token estimation (no external tokenizer dependency).
 *
 * Strategy:
 *   - CJK chars ≈ 1 token each (BPE models assign ~0.6-1.2 token/char)
 *   - other chars ≈ 1 token per 4 (typical English ratio)
 *   - per-message overhead ≈ 4 tokens (role markers, separators)
 *   - tool-call arguments are JSON text → same estimate
 *
 * This is intentionally an upper-ish bound so the context manager keeps a
 * conservative window; exact counts come from provider usage fields.
 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK)?.length ?? 0;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.1 + other / 4);
}

export const MESSAGE_OVERHEAD = 4;

export function messageTokens(content: string, extra = ""): number {
  return estimateTokens(content) + estimateTokens(extra) + MESSAGE_OVERHEAD;
}

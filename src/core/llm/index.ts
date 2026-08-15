/**
 * Provider factory: builds a ChatProvider from a config Provider definition.
 */
import type { ChatProvider } from "./types.ts";
import { OpenAIProvider } from "./openai.ts";
import { AnthropicProvider } from "./anthropic.ts";
import type { Provider } from "../config.ts";

export interface ProviderOptions {
  provider: Provider;
  apiKey: string;
  /** Override base URL (custom providers). */
  baseUrl?: string;
}

export function createProvider(opts: ProviderOptions): ChatProvider {
  const baseUrl = opts.baseUrl ?? opts.provider.baseUrl;
  if (opts.provider.apiStyle === "anthropic") {
    return new AnthropicProvider({ apiKey: opts.apiKey, baseUrl });
  }
  return new OpenAIProvider(opts.provider.id, {
    baseUrl,
    apiKey: opts.apiKey,
  }, opts.provider.supportsCache);
}

export * from "./types.ts";
export { OpenAIProvider } from "./openai.ts";
export { AnthropicProvider } from "./anthropic.ts";
export { parseSSE } from "./sse.ts";

import type { Model } from "@earendil-works/pi-ai";
import { streamSimple as openaiStream } from "@earendil-works/pi-ai/api/openai-completions";
import type { ApiSettings } from "../app/state.ts";
import { createBrowserFetch, normalizeBaseUrl } from "./browserFetch.ts";

const IDENTITY_THINKING_LEVEL_MAP = {
  off: null,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const;

export function createModel(settings: ApiSettings): Model<"openai-completions"> {
  return { id: settings.modelId, name: settings.modelId, api: "openai-completions", provider: "custom-openai-compatible", baseUrl: normalizeBaseUrl(settings.baseUrl), reasoning: settings.reasoningLevel !== "off", thinkingLevelMap: IDENTITY_THINKING_LEVEL_MAP, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: settings.maxOutputTokens };
}

export function createStreamFunction(settings: ApiSettings) {
  const fetch = createBrowserFetch(settings.baseUrl);
  return (model: Model<any>, context: Parameters<typeof openaiStream>[1], options?: Parameters<typeof openaiStream>[2]) => openaiStream(model as Model<"openai-completions">, context, { ...options, apiKey: settings.apiKey, fetch });
}

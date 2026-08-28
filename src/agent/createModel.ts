import type { Model } from "@earendil-works/pi-ai";
import { streamSimple as openaiStream } from "@earendil-works/pi-ai/api/openai-completions";
import type { ApiSettings } from "../app/state.ts";
import { createServerFetch } from "./serverFetch.ts";

function backendBaseUrl(): string {
  return typeof window === "undefined" ? "https://pi-webdesk.local/api" : new URL("/api", window.location.origin).toString();
}

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
  return { id: settings.modelId, name: settings.modelId, api: "openai-completions", provider: "custom-openai-compatible", baseUrl: backendBaseUrl(), reasoning: settings.reasoningLevel !== "off", thinkingLevelMap: IDENTITY_THINKING_LEVEL_MAP, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: settings.maxOutputTokens };
}

export function createStreamFunction(settings: ApiSettings) {
  const fetch = createServerFetch(backendBaseUrl(), settings.activeProviderId);
  return (model: Model<any>, context: Parameters<typeof openaiStream>[1], options?: Parameters<typeof openaiStream>[2]) => openaiStream(model as Model<"openai-completions">, context, { ...options, apiKey: settings.apiKey || "server-managed", fetch });
}

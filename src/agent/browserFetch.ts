import { REASONING_LEVELS, type ReasoningLevel } from "../app/state.ts";

export function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("API base URL must use http or https");
  if (parsed.protocol === "http:" && location.protocol === "https:") throw new Error("API URL must use HTTPS when the app is served over HTTPS");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "") || "/";
  return parsed.pathname === "/" ? `${parsed.origin}/` : parsed.toString();
}

export function createBrowserFetch(allowedBaseUrl: string): typeof fetch {
  const allowed = new URL(normalizeBaseUrl(allowedBaseUrl));
  return (async (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const allowedPath = allowed.pathname.replace(/\/+$/, "");
    const pathAllowed = allowedPath === "" || target.pathname === allowedPath || target.pathname.startsWith(`${allowedPath}/`);
    if (target.origin !== allowed.origin || !pathAllowed) throw new TypeError("Request blocked: URL is outside the configured API base URL");
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete("user-agent");
    headers.delete("host");
    try {
      return await fetch(target, { ...init, headers });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new TypeError(`API request was blocked by the browser${detail} Check the provider URL and allow ${location.origin} in its CORS policy.`);
    }
  }) as typeof fetch;
}

export interface ReasoningCapabilities {
  levels: ReasoningLevel[];
  defaultLevel?: ReasoningLevel;
  mandatory: boolean;
}

interface ModelRecord {
  id?: unknown;
  name?: unknown;
  reasoning?: unknown;
}

export interface ApiModelRecord {
  id: string;
  name?: string;
  reasoning?: ReasoningCapabilities;
}

function canonicalReasoningLevel(value: unknown): ReasoningLevel | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  return (REASONING_LEVELS as readonly string[]).includes(normalized) ? normalized as ReasoningLevel : undefined;
}

function readReasoningCapabilities(value: unknown): ReasoningCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = value as { supported_efforts?: unknown; default_effort?: unknown; mandatory?: unknown };
  if (!Array.isArray(metadata.supported_efforts)) return undefined;
  const supported = new Set<ReasoningLevel>();
  for (const effort of metadata.supported_efforts) {
    const level = canonicalReasoningLevel(effort);
    if (level) supported.add(level);
  }
  if (supported.size === 0) return undefined;

  const mandatory = metadata.mandatory === true;
  if (!mandatory) supported.add("off");
  const levels = REASONING_LEVELS.filter((level) => supported.has(level));
  if (levels.length === 0) return undefined;
  const defaultLevel = canonicalReasoningLevel(metadata.default_effort);
  return { levels, defaultLevel: defaultLevel && levels.includes(defaultLevel) ? defaultLevel : undefined, mandatory };
}

function readModelRecords(payload: unknown): ApiModelRecord[] | undefined {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) return undefined;
  return (payload as { data: ModelRecord[] }).data.flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id.trim()) return [];
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined;
    const reasoning = readReasoningCapabilities(item.reasoning);
    return [{ id: item.id.trim(), ...(name ? { name } : {}), ...(reasoning ? { reasoning } : {}) }];
  });
}

async function fetchModelPayload(baseUrl: string, apiKey: string): Promise<unknown> {
  const normalized = normalizeBaseUrl(baseUrl);
  const response = await createBrowserFetch(normalized)(`${normalized.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`Model metadata check failed (${response.status} ${response.statusText})`);

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function fetchModelCatalog(baseUrl: string, apiKey: string): Promise<ApiModelRecord[] | undefined> {
  return readModelRecords(await fetchModelPayload(baseUrl, apiKey));
}

export async function fetchReasoningCapabilities(baseUrl: string, apiKey: string, modelId: string): Promise<ReasoningCapabilities | undefined> {
  const models = await fetchModelCatalog(baseUrl, apiKey);
  return models?.find((model) => model.id === modelId)?.reasoning;
}

export async function checkApi(baseUrl: string, apiKey: string): Promise<string> {
  const normalized = normalizeBaseUrl(baseUrl);
  const response = await createBrowserFetch(normalized)(`${normalized.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`API check failed (${response.status} ${response.statusText})`);
  return "API reachable";
}

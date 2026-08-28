import { REASONING_LEVELS, type ProviderModel, type ProviderProfile, type ReasoningLevel } from "../app/state.ts";

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

async function get(path: "/api/models" | "/api/health"): Promise<Response> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Server API request failed (${response.status} ${response.statusText})`);
  return response;
}

function readProviderProfiles(payload: unknown): ProviderProfile[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { providers?: unknown }).providers)) return [];
  return (payload as { providers: unknown[] }).providers.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as { id?: unknown; name?: unknown; models?: unknown };
    if (typeof candidate.id !== "string" || !candidate.id.trim()) return [];
    const models: ProviderModel[] = Array.isArray(candidate.models) ? candidate.models.flatMap((model) => {
      if (!model || typeof model !== "object") return [];
      const record = model as { id?: unknown; name?: unknown; reasoningLevels?: unknown; defaultReasoningLevel?: unknown; reasoning?: unknown };
      if (typeof record.id !== "string" || !record.id.trim()) return [];
      const levels = Array.isArray(record.reasoningLevels)
        ? record.reasoningLevels.map(canonicalReasoningLevel).filter((level): level is ReasoningLevel => Boolean(level))
        : readReasoningCapabilities(record.reasoning)?.levels;
      const defaultLevel = canonicalReasoningLevel(record.defaultReasoningLevel) ?? readReasoningCapabilities(record.reasoning)?.defaultLevel;
      return [{ id: record.id.trim(), ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim() } : {}), ...(levels?.length ? { reasoningLevels: levels, ...(defaultLevel ? { defaultReasoningLevel: defaultLevel } : {}) } : {}) }];
    }) : [];
    return [{ id: candidate.id, name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : "Provider", baseUrl: "/api", apiKey: "", rememberKey: false, models }];
  });
}

export async function fetchServerProviders(): Promise<ProviderProfile[]> {
  const response = await fetch("/api/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Server configuration request failed (${response.status} ${response.statusText})`);
  return readProviderProfiles(await response.json());
}

export async function fetchModelCatalog(): Promise<ApiModelRecord[] | undefined> {
  const response = await get("/api/models");
  return readModelRecords(await response.json());
}

export async function fetchReasoningCapabilities(modelId: string): Promise<ReasoningCapabilities | undefined> {
  const models = await fetchModelCatalog();
  return models?.find((model) => model.id === modelId)?.reasoning;
}

export async function checkApi(): Promise<string> {
  const response = await get("/api/health");
  const payload: unknown = await response.json().catch(() => undefined);
  if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) throw new Error("Application API returned an invalid health response");
  return "Server API reachable";
}

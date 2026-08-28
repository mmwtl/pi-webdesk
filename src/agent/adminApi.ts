export interface AdminProvider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminModel {
  id: string;
  providerId: string;
  modelId: string;
  name?: string;
  enabled: boolean;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

export interface ModelInput {
  providerId: string;
  modelId: string;
  name?: string;
  enabled: boolean;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
}

export interface DiscoveredModel {
  id: string;
  modelId: string;
  name?: string;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
}

export interface AdminSession {
  authenticated: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function idFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function apiError(payload: unknown, response: Response): string {
  if (isRecord(payload)) {
    const error = text(payload.error) ?? text(payload.message);
    if (error) return error;
  }
  return `Admin API request failed (${response.status} ${response.statusText})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("json") ? await response.json().catch(() => undefined) : await response.text().catch(() => "");
  if (!response.ok) throw new Error(apiError(payload, response));
  return payload as T;
}

function unwrapList(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key] as unknown[];
  return [];
}

function normalizeProvider(value: unknown): AdminProvider | undefined {
  if (!isRecord(value)) return undefined;
  const id = idFrom(value.id);
  const name = text(value.name);
  const baseUrl = text(value.baseUrl) ?? text(value.base_url);
  if (!id || !name || !baseUrl) return undefined;
  const masked = text(value.apiKeyMasked) ?? text(value.api_key_masked) ?? text(value.keyMasked);
  const configured = typeof value.apiKeyConfigured === "boolean" ? value.apiKeyConfigured : typeof value.api_key_configured === "boolean" ? value.api_key_configured : typeof value.hasApiKey === "boolean" ? value.hasApiKey : typeof value.has_api_key === "boolean" ? value.has_api_key : Boolean(masked);
  return {
    id,
    name,
    baseUrl,
    enabled: bool(value.enabled),
    apiKeyConfigured: configured,
    ...(masked ? { apiKeyMasked: masked } : {}),
    ...(text(value.createdAt) ? { createdAt: text(value.createdAt) } : {}),
    ...(text(value.updatedAt) ? { updatedAt: text(value.updatedAt) } : {}),
  };
}

function normalizeModel(value: unknown, fallbackProviderId?: string): AdminModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = idFrom(value.id) ?? idFrom(value.modelId) ?? idFrom(value.model_id);
  const modelId = text(value.modelId) ?? text(value.model_id) ?? text(value.id);
  const providerId = idFrom(value.providerId) ?? idFrom(value.provider_id) ?? fallbackProviderId;
  if (!id || !modelId || !providerId) return undefined;
  const reasoning = isRecord(value.reasoning) ? value.reasoning : undefined;
  const levels = Array.isArray(value.reasoningLevels) ? value.reasoningLevels : Array.isArray(value.reasoning_levels) ? value.reasoning_levels : Array.isArray(reasoning?.levels) ? reasoning.levels : undefined;
  const normalizedLevels = levels?.filter((level): level is string => typeof level === "string" && Boolean(level.trim())).map((level) => level.trim());
  const defaultLevel = text(value.defaultReasoningLevel) ?? text(value.default_reasoning_level) ?? text(reasoning?.defaultLevel) ?? text(reasoning?.default_level);
  return {
    id,
    providerId,
    modelId,
    enabled: bool(value.enabled),
    ...(text(value.name) ?? text(value.displayName) ? { name: text(value.name) ?? text(value.displayName) } : {}),
    ...(normalizedLevels?.length ? { reasoningLevels: normalizedLevels } : {}),
    ...(defaultLevel ? { defaultReasoningLevel: defaultLevel } : {}),
  };
}

function normalizeDiscovered(value: unknown): DiscoveredModel | undefined {
  const model = normalizeModel(value, "discovered");
  if (!model) {
    if (!isRecord(value)) return undefined;
    const modelId = text(value.modelId) ?? text(value.model_id) ?? text(value.id);
    if (!modelId) return undefined;
    return { id: modelId, modelId, ...(text(value.name) ? { name: text(value.name) } : {}) };
  }
  return {
    id: model.modelId,
    modelId: model.modelId,
    ...(model.name ? { name: model.name } : {}),
    ...(model.reasoningLevels ? { reasoningLevels: model.reasoningLevels } : {}),
    ...(model.defaultReasoningLevel ? { defaultReasoningLevel: model.defaultReasoningLevel } : {}),
  };
}

export async function getAdminSession(): Promise<AdminSession> {
  const payload = await request<unknown>("/api/admin/session", { method: "GET" });
  return { authenticated: isRecord(payload) && (payload.authenticated === true || payload.ok === true) };
}

export async function loginAdmin(password: string): Promise<AdminSession> {
  const payload = await request<unknown>("/api/admin/session", { method: "POST", body: JSON.stringify({ password }) });
  return { authenticated: !isRecord(payload) || payload.authenticated !== false };
}

export async function logoutAdmin(): Promise<void> {
  await request("/api/admin/session", { method: "DELETE" });
}

export async function listAdminProviders(): Promise<AdminProvider[]> {
  const payload = await request<unknown>("/api/admin/providers");
  return unwrapList(payload, ["providers", "data"]).flatMap((value) => {
    const provider = normalizeProvider(value);
    return provider ? [provider] : [];
  });
}

export async function createAdminProvider(input: ProviderInput): Promise<AdminProvider> {
  const payload = await request<unknown>("/api/admin/providers", { method: "POST", body: JSON.stringify(input) });
  const provider = normalizeProvider(isRecord(payload) && payload.provider ? payload.provider : payload);
  if (!provider) throw new Error("The server returned an invalid provider");
  return provider;
}

export async function updateAdminProvider(id: string, input: Partial<ProviderInput>): Promise<AdminProvider> {
  const payload = await request<unknown>(`/api/admin/providers?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  const provider = normalizeProvider(isRecord(payload) && payload.provider ? payload.provider : payload);
  if (!provider) throw new Error("The server returned an invalid provider");
  return provider;
}

export async function deleteAdminProvider(id: string): Promise<void> {
  await request(`/api/admin/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listAdminModels(providerId?: string): Promise<AdminModel[]> {
  const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : "";
  const payload = await request<unknown>(`/api/admin/models${query}`);
  return unwrapList(payload, ["models", "data"]).flatMap((value) => {
    const model = normalizeModel(value, providerId);
    return model ? [model] : [];
  });
}

export async function createAdminModel(input: ModelInput): Promise<AdminModel> {
  const payload = await request<unknown>("/api/admin/models", { method: "POST", body: JSON.stringify(input) });
  const model = normalizeModel(isRecord(payload) && payload.model ? payload.model : payload, input.providerId);
  if (!model) throw new Error("The server returned an invalid model");
  return model;
}

export async function updateAdminModel(id: string, input: Partial<ModelInput>): Promise<AdminModel> {
  const payload = await request<unknown>(`/api/admin/models?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  const model = normalizeModel(isRecord(payload) && payload.model ? payload.model : payload, input.providerId);
  if (!model) throw new Error("The server returned an invalid model");
  return model;
}

export async function deleteAdminModel(id: string): Promise<void> {
  await request(`/api/admin/models?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function discoverAdminModels(providerId: string): Promise<DiscoveredModel[]> {
  const payload = await request<unknown>("/api/admin/discover-models", { method: "POST", body: JSON.stringify({ providerId }) });
  return unwrapList(payload, ["models", "data"]).flatMap((value) => {
    const model = normalizeDiscovered(value);
    return model ? [model] : [];
  });
}

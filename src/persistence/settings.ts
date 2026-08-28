import { defaultSettings, normalizeReasoningLevel, type ApiSettings, type ProviderModel, type ProviderProfile, type ReasoningLevel } from "../app/state.ts";
import { idbGet, idbPut } from "./database.ts";

const SETTINGS_KEY = "current";
const SERVER_PROVIDER: ProviderProfile = {
  id: "server-api",
  name: "Server API",
  baseUrl: "/api",
  apiKey: "",
  rememberKey: false,
  models: [],
};
let saveQueue: Promise<void> = Promise.resolve();
type StoredSettings = Partial<ApiSettings> & { reasoningEnabled?: boolean };

function normalizeModel(value: unknown): ProviderModel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { id?: unknown; name?: unknown; reasoningLevels?: unknown; defaultReasoningLevel?: unknown };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return undefined;
  const reasoningLevels = Array.isArray(candidate.reasoningLevels)
    ? candidate.reasoningLevels.map((level) => normalizeReasoningLevel(level)).filter((level, index, all) => all.indexOf(level) === index)
    : undefined;
  const defaultReasoningLevel = candidate.defaultReasoningLevel === undefined ? undefined : normalizeReasoningLevel(candidate.defaultReasoningLevel);
  return { id: candidate.id.trim(), ...(typeof candidate.name === "string" && candidate.name.trim() ? { name: candidate.name.trim() } : {}), ...(reasoningLevels?.length ? { reasoningLevels: reasoningLevels as ReasoningLevel[] } : {}), ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}) };
}

function normalizeProvider(value: unknown, fallback: ProviderProfile, index: number): ProviderProfile {
  if (!value || typeof value !== "object") return { ...fallback, id: `${fallback.id}-${index}` };
  const candidate = value as Partial<ProviderProfile>;
  const models = Array.isArray(candidate.models) ? candidate.models.map(normalizeModel).filter((model): model is ProviderModel => Boolean(model)) : [];
  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `${fallback.id}-${index}`,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : `${fallback.name} ${index + 1}`,
    baseUrl: typeof candidate.baseUrl === "string" && candidate.baseUrl.trim() ? candidate.baseUrl : fallback.baseUrl,
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
    rememberKey: candidate.rememberKey === true,
    models,
  };
}

function browserSafeProvider(provider: ProviderProfile): ProviderProfile {
  return { ...provider, baseUrl: "/api", apiKey: "", rememberKey: false };
}

export async function loadSettings(): Promise<ApiSettings> {
  const stored = await idbGet<StoredSettings>("settings", SETTINGS_KEY);
  const legacyReasoningLevel = stored?.reasoningEnabled ? "medium" : "off";
  const { reasoningEnabled: _legacyReasoningEnabled, ...saved } = stored ?? {};
  const rawProviders = Array.isArray(stored?.providers) ? stored.providers : [];
  const providers = rawProviders.length
    ? rawProviders.map((provider, index) => browserSafeProvider(normalizeProvider(provider, SERVER_PROVIDER, index)))
    : [{ ...SERVER_PROVIDER, models: [{ id: stored?.modelId ?? defaultSettings.modelId }] }];
  const activeProvider = providers.find((provider) => provider.id === stored?.activeProviderId) ?? providers[0];
  const activeModel = activeProvider.models.find((model) => model.id === stored?.modelId) ?? activeProvider.models[0];
  const userPrompt = typeof stored?.userPrompt === "string" ? stored.userPrompt : defaultSettings.userPrompt;
  const settings: ApiSettings = {
    ...defaultSettings,
    ...saved,
    providers,
    activeProviderId: activeProvider.id,
    baseUrl: SERVER_PROVIDER.baseUrl,
    apiKey: "",
    modelId: activeModel?.id ?? stored?.modelId ?? defaultSettings.modelId,
    rememberKey: false,
    reasoningLevel: normalizeReasoningLevel(stored?.reasoningLevel ?? legacyReasoningLevel),
    userPrompt,
  };
  const hasLegacyKey = Boolean(stored?.apiKey) || rawProviders.some((provider) => Boolean((provider as Partial<ProviderProfile>)?.apiKey));
  if (hasLegacyKey) await saveSettings(settings);
  return settings;
}

export function saveSettings(settings: ApiSettings): Promise<void> {
  const providers = settings.providers.length
    ? settings.providers.map(browserSafeProvider)
    : [{ ...SERVER_PROVIDER, models: [{ id: settings.modelId || defaultSettings.modelId }] }];
  const activeProviderId = providers.some((provider) => provider.id === settings.activeProviderId) ? settings.activeProviderId : providers[0].id;
  const value = { ...settings, providers, activeProviderId, baseUrl: SERVER_PROVIDER.baseUrl, apiKey: "", rememberKey: false };
  const write = saveQueue.then(() => idbPut("settings", value, SETTINGS_KEY));
  // A failed write must not permanently block later saves.
  saveQueue = write.catch(() => undefined);
  return write;
}

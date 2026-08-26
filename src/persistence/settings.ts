import { defaultSettings, normalizeReasoningLevel, type ApiSettings, type ProviderModel, type ProviderProfile, type ReasoningLevel } from "../app/state.ts";
import { idbGet, idbPut } from "./database.ts";

const SETTINGS_KEY = "current";
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

export async function loadSettings(): Promise<ApiSettings> {
  const stored = await idbGet<StoredSettings>("settings", SETTINGS_KEY);
  const legacyReasoningLevel = stored?.reasoningEnabled ? "medium" : "off";
  const { reasoningEnabled: _legacyReasoningEnabled, ...saved } = stored ?? {};
  const rawProviders = Array.isArray(stored?.providers) ? stored.providers : undefined;
  const providers = rawProviders?.length
    ? rawProviders.map((provider, index) => normalizeProvider(provider, defaultSettings.providers[0], index))
    : [normalizeProvider({
      ...defaultSettings.providers[0],
      baseUrl: stored?.baseUrl ?? defaultSettings.baseUrl,
      apiKey: stored?.rememberKey ? stored?.apiKey ?? "" : "",
      rememberKey: stored?.rememberKey === true,
      models: [{ id: stored?.modelId ?? defaultSettings.modelId }],
    }, defaultSettings.providers[0], 0)];
  const activeProvider = providers.find((provider) => provider.id === stored?.activeProviderId) ?? providers[0];
  const activeModel = activeProvider.models.find((model) => model.id === stored?.modelId) ?? activeProvider.models[0];
  const activeApiKey = activeProvider.rememberKey ? activeProvider.apiKey : (stored?.rememberKey ? stored?.apiKey ?? "" : activeProvider.apiKey);
  const userPrompt = typeof stored?.userPrompt === "string" ? stored.userPrompt : defaultSettings.userPrompt;
  return {
    ...defaultSettings,
    ...saved,
    providers,
    activeProviderId: activeProvider.id,
    baseUrl: activeProvider.baseUrl,
    apiKey: activeApiKey,
    modelId: activeModel?.id ?? stored?.modelId ?? defaultSettings.modelId,
    rememberKey: activeProvider.rememberKey,
    reasoningLevel: normalizeReasoningLevel(stored?.reasoningLevel ?? legacyReasoningLevel),
    userPrompt,
  };
}

export function saveSettings(settings: ApiSettings): Promise<void> {
  const providers = settings.providers.map((provider) => ({ ...provider, apiKey: provider.rememberKey ? provider.apiKey : "" }));
  const activeProvider = providers.find((provider) => provider.id === settings.activeProviderId);
  const value = { ...settings, providers, apiKey: settings.rememberKey ? settings.apiKey : "", ...(activeProvider ? { baseUrl: activeProvider.baseUrl, modelId: settings.modelId } : {}) };
  const write = saveQueue.then(() => idbPut("settings", value, SETTINGS_KEY));
  // A failed write must not permanently block later saves.
  saveQueue = write.catch(() => undefined);
  return write;
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminModel,
  createAdminProvider,
  deleteAdminModel,
  deleteAdminProvider,
  discoverAdminModels,
  getAdminSession,
  listAdminModels,
  listAdminProviders,
  loginAdmin,
  logoutAdmin,
  updateAdminModel,
  updateAdminProvider,
  type AdminModel,
  type AdminProvider,
  type DiscoveredModel,
} from "../agent/adminApi.ts";

export interface ProviderAdminProps {
  className?: string;
  onChanged?: () => void;
}

type Status = "idle" | "loading" | "saving" | "error";
type ProviderDraft = { name: string; baseUrl: string; apiKey: string; enabled: boolean };
type ModelDraft = { modelId: string; name: string; enabled: boolean };

const EMPTY_PROVIDER: ProviderDraft = { name: "", baseUrl: "", apiKey: "", enabled: true };
const EMPTY_MODEL: ModelDraft = { modelId: "", name: "", enabled: true };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function providerDraft(provider?: AdminProvider): ProviderDraft {
  return provider ? { name: provider.name, baseUrl: provider.baseUrl, apiKey: "", enabled: provider.enabled } : EMPTY_PROVIDER;
}

function modelDraft(model?: AdminModel): ModelDraft {
  return model ? { modelId: model.modelId, name: model.name ?? "", enabled: model.enabled } : EMPTY_MODEL;
}

function fieldValue(event: React.ChangeEvent<HTMLInputElement>): string {
  return event.target.value;
}

export function ProviderAdmin({ className, onChanged }: ProviderAdminProps) {
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerDraftState, setProviderDraftState] = useState<ProviderDraft>(EMPTY_PROVIDER);
  const [modelDraftState, setModelDraftState] = useState<ModelDraft>(EMPTY_MODEL);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [discoveries, setDiscoveries] = useState<DiscoveredModel[]>([]);
  const [selectedDiscoveries, setSelectedDiscoveries] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [loginError, setLoginError] = useState("");

  const selectedProvider = useMemo(() => providers.find((provider) => provider.id === selectedProviderId), [providers, selectedProviderId]);
  const selectedModels = useMemo(() => models.filter((model) => model.providerId === selectedProviderId), [models, selectedProviderId]);

  const load = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    try {
      const [nextProviders, nextModels] = await Promise.all([listAdminProviders(), listAdminModels()]);
      setProviders(nextProviders);
      setModels(nextModels);
      setSelectedProviderId((current) => current && nextProviders.some((provider) => provider.id === current) ? current : nextProviders[0]?.id ?? null);
      setStatus("idle");
    } catch (reason) {
      setStatus("error");
      setMessage(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAdminSession().then((session) => {
      if (cancelled) return;
      setAuthenticated(session.authenticated);
      if (session.authenticated) void load();
      else setStatus("idle");
    }).catch((reason) => {
      if (!cancelled) { setAuthenticated(false); setStatus("idle"); setLoginError(errorMessage(reason)); }
    });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (!addingProvider) setProviderDraftState(providerDraft(selectedProvider));
  }, [addingProvider, selectedProvider]);

  const refresh = async (notice?: string) => {
    await load();
    onChanged?.();
    if (notice) setMessage(notice);
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setStatus("loading");
    setLoginError("");
    try {
      const session = await loginAdmin(password);
      if (!session.authenticated) throw new Error("Invalid admin password");
      setPassword("");
      setAuthenticated(true);
      await load();
    } catch (reason) {
      setStatus("idle");
      setLoginError(errorMessage(reason));
    }
  };

  const saveProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!providerDraftState.name.trim() || !providerDraftState.baseUrl.trim()) { setMessage("Name and base URL are required."); return; }
    setStatus("saving");
    setMessage("");
    try {
      if (addingProvider) {
        const created = await createAdminProvider({ ...providerDraftState, name: providerDraftState.name.trim(), baseUrl: providerDraftState.baseUrl.trim(), ...(providerDraftState.apiKey.trim() ? { apiKey: providerDraftState.apiKey } : {}) });
        setAddingProvider(false);
        setSelectedProviderId(created.id);
      } else if (selectedProvider) {
        await updateAdminProvider(selectedProvider.id, { name: providerDraftState.name.trim(), baseUrl: providerDraftState.baseUrl.trim(), enabled: providerDraftState.enabled, ...(providerDraftState.apiKey.trim() ? { apiKey: providerDraftState.apiKey } : {}) });
      }
      await refresh("Provider saved.");
    } catch (reason) { setStatus("error"); setMessage(errorMessage(reason)); }
  };

  const removeProvider = async () => {
    if (!selectedProvider || !window.confirm(`Delete provider “${selectedProvider.name}” and its models?`)) return;
    setStatus("saving");
    try { await deleteAdminProvider(selectedProvider.id); await refresh("Provider deleted."); }
    catch (reason) { setStatus("error"); setMessage(errorMessage(reason)); }
  };

  const saveModel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProvider || !modelDraftState.modelId.trim()) { setMessage("Model ID is required."); return; }
    setStatus("saving");
    try {
      const input = { providerId: selectedProvider.id, modelId: modelDraftState.modelId.trim(), name: modelDraftState.name.trim() || undefined, enabled: modelDraftState.enabled };
      if (editingModelId) await updateAdminModel(editingModelId, input);
      else await createAdminModel(input);
      setAddingModel(false); setEditingModelId(null); setModelDraftState(EMPTY_MODEL);
      await refresh("Model saved.");
    } catch (reason) { setStatus("error"); setMessage(errorMessage(reason)); }
  };

  const removeModel = async (model: AdminModel) => {
    if (!window.confirm(`Delete model “${model.modelId}”?`)) return;
    setStatus("saving");
    try { await deleteAdminModel(model.id); await refresh("Model deleted."); }
    catch (reason) { setStatus("error"); setMessage(errorMessage(reason)); }
  };

  const discover = async () => {
    if (!selectedProvider) return;
    setStatus("loading"); setMessage("");
    try {
      const next = await discoverAdminModels(selectedProvider.id);
      setDiscoveries(next); setSelectedDiscoveries(new Set(next.map((model) => model.modelId))); setStatus("idle");
      if (!next.length) setMessage("The provider returned no models.");
    } catch (reason) { setStatus("error"); setMessage(errorMessage(reason)); }
  };

  const importDiscoveries = async () => {
    if (!selectedProvider || selectedDiscoveries.size === 0) return;
    setStatus("saving");
    try {
      const existing = new Set(selectedModels.map((model) => model.modelId));
      const imports = discoveries.filter((model) => selectedDiscoveries.has(model.modelId) && !existing.has(model.modelId));
      await Promise.all(imports.map((model) => createAdminModel({ providerId: selectedProvider.id, modelId: model.modelId, name: model.name, enabled: true, reasoningLevels: model.reasoningLevels, defaultReasoningLevel: model.defaultReasoningLevel })));
      setDiscoveries([]); setSelectedDiscoveries(new Set()); await refresh(`${imports.length} model${imports.length === 1 ? "" : "s"} imported.`);
    } catch (reason) { setStatus("error"); setMessage(errorMessage(reason)); }
  };

  const signOut = async () => {
    try { await logoutAdmin(); } finally { setAuthenticated(false); setProviders([]); setModels([]); setSelectedProviderId(null); }
  };

  if (authenticated === undefined) return <section className={className} aria-busy="true"><p className="dialog-note">Checking admin session…</p></section>;
  if (!authenticated) return <section className={className}><form className="provider-editor" onSubmit={(event) => void submitLogin(event)}><div className="provider-editor-heading"><div><strong>Provider administration</strong><small>Sign in to manage server-side provider credentials and models.</small></div></div><label className="setting-field"><span className="field-title">Admin password</span><input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(fieldValue(event))} autoFocus /></label>{loginError && <div className="settings-validation" role="alert">{loginError}</div>}<div className="dialog-actions"><button className="wide-button" type="submit" disabled={status === "loading" || !password}>{status === "loading" ? "Signing in…" : "Sign in"}</button></div></form></section>;

  return <section className={className} aria-busy={status === "loading" || status === "saving"}>
    <div className="provider-editor-heading"><div><strong>Provider administration</strong><small>Credentials stay on the server and are never returned to the browser.</small></div><button className="ghost-button" type="button" onClick={() => void signOut()}>Sign out</button></div>
    {message && <div className={status === "error" ? "settings-validation" : "dialog-note"} role={status === "error" ? "alert" : "status"}>{message}</div>}
    <div className="provider-layout">
      <div className="provider-list"><strong className="dialog-section-label">PROVIDERS</strong>{providers.map((provider) => <button type="button" className={`provider-tab ${provider.id === selectedProviderId ? "selected" : ""}`} key={provider.id} onClick={() => { setAddingProvider(false); setSelectedProviderId(provider.id); setDiscoveries([]); }}><span className="provider-mark letter">{provider.name.slice(0, 1).toUpperCase()}</span><span><strong>{provider.name}</strong><small>{provider.enabled ? "Enabled" : "Disabled"}{provider.apiKeyConfigured ? " · Key set" : " · No key"}</small></span></button>)}<button className="add-provider" type="button" onClick={() => { setAddingProvider(true); setSelectedProviderId(null); setProviderDraftState(EMPTY_PROVIDER); }}><span>＋</span>Add provider</button></div>
      {(selectedProvider || addingProvider) && <form className="provider-editor" onSubmit={(event) => void saveProvider(event)}><div className="provider-editor-heading"><div><strong>{addingProvider ? "New provider" : selectedProvider?.name}</strong><small>OpenAI-compatible base URL and server API key.</small></div>{!addingProvider && <button className="remove-provider" type="button" onClick={() => void removeProvider()}>Delete</button>}</div><label className="setting-field"><span className="field-title">Name</span><input value={providerDraftState.name} onChange={(event) => setProviderDraftState((current) => ({ ...current, name: fieldValue(event) }))} required /></label><label className="setting-field"><span className="field-title">Base URL</span><input type="url" value={providerDraftState.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setProviderDraftState((current) => ({ ...current, baseUrl: fieldValue(event) }))} required /></label><label className="setting-field"><span className="field-title">API key</span><input type="password" value={providerDraftState.apiKey} placeholder={!addingProvider && selectedProvider?.apiKeyConfigured ? selectedProvider.apiKeyMasked ?? "Saved key (leave empty to keep)" : "sk-…"} autoComplete="new-password" onChange={(event) => setProviderDraftState((current) => ({ ...current, apiKey: fieldValue(event) }))} /><small className="field-helper">{!addingProvider && selectedProvider?.apiKeyConfigured ? "A saved key is masked. Leave empty to keep it unchanged." : "Stored encrypted on the server."}</small></label><label className="switch-row"><button className={`switch ${providerDraftState.enabled ? "on" : ""}`} type="button" role="switch" aria-checked={providerDraftState.enabled} onClick={() => setProviderDraftState((current) => ({ ...current, enabled: !current.enabled }))}><span /></button><span><strong>Enabled</strong><small>Disabled providers cannot be selected for chat requests.</small></span></label><div className="dialog-actions"><button className="wide-button" type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save provider"}</button></div></form>}
    </div>
    {selectedProvider && <section className="provider-editor"><div className="provider-editor-heading"><div><strong>Models</strong><small>{selectedModels.length} configured for {selectedProvider.name}</small></div><div className="provider-api-actions"><button className="ghost-button" type="button" onClick={() => void discover()} disabled={status === "loading"}>Discover models</button><button className="ghost-button" type="button" onClick={() => { setAddingModel(true); setEditingModelId(null); setModelDraftState(EMPTY_MODEL); }}>＋ Add model</button></div></div><div className="selected-models">{selectedModels.map((model) => <span className="selected-model" key={model.id}><span title={model.modelId}>{model.name && model.name !== model.modelId ? `${model.name} · ${model.modelId}` : model.modelId}</span><button type="button" aria-label={`Edit ${model.modelId}`} onClick={() => { setAddingModel(true); setEditingModelId(model.id); setModelDraftState(modelDraft(model)); }}>✎</button><button type="button" aria-label={`Remove ${model.modelId}`} onClick={() => void removeModel(model)}>×</button></span>)}{selectedModels.length === 0 && <span className="no-selected-models">No models configured yet.</span>}</div>{(addingModel || editingModelId) && <form className="provider-editor" onSubmit={(event) => void saveModel(event)}><label className="setting-field"><span className="field-title">Model ID</span><input value={modelDraftState.modelId} onChange={(event) => setModelDraftState((current) => ({ ...current, modelId: fieldValue(event) }))} required /></label><label className="setting-field"><span className="field-title">Display name <small>(optional)</small></span><input value={modelDraftState.name} onChange={(event) => setModelDraftState((current) => ({ ...current, name: fieldValue(event) }))} /></label><label className="switch-row"><button className={`switch ${modelDraftState.enabled ? "on" : ""}`} type="button" role="switch" aria-checked={modelDraftState.enabled} onClick={() => setModelDraftState((current) => ({ ...current, enabled: !current.enabled }))}><span /></button><span><strong>Enabled</strong><small>Show this model in the application.</small></span></label><div className="dialog-actions"><button className="ghost-button" type="button" onClick={() => { setAddingModel(false); setEditingModelId(null); }}>Cancel</button><button className="wide-button" type="submit">{editingModelId ? "Save model" : "Add model"}</button></div></form>}
      {discoveries.length > 0 && <div className="model-suggestions" role="listbox" aria-label="Discovered models">{discoveries.map((model) => <label className="model-suggestion" key={model.modelId}><input type="checkbox" checked={selectedDiscoveries.has(model.modelId)} onChange={() => setSelectedDiscoveries((current) => { const next = new Set(current); if (next.has(model.modelId)) next.delete(model.modelId); else next.add(model.modelId); return next; })} /><span><strong>{model.name && model.name !== model.modelId ? model.name : model.modelId}</strong><small>{model.modelId}</small></span></label>)}<div className="dialog-actions"><button className="wide-button" type="button" onClick={() => void importDiscoveries()} disabled={!selectedDiscoveries.size || status === "saving"}>Import selected ({selectedDiscoveries.size})</button></div></div>}
    </section>}
  </section>;
}

export default ProviderAdmin;

import { randomUUID } from "node:crypto";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { decryptApiKey, encryptApiKey, type EncryptedSecret } from "./crypto";
import { getRuntimeConfig } from "./config";

export type DatabaseClient = NeonQueryFunction<false, false>;

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shape safe to return to the browser. It deliberately contains no URL or secret. */
export interface ProviderConfig {
  id: string;
  name: string;
  models: PublicModelConfig[];
}

export interface PublicModelConfig {
  id: string;
  name?: string;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
}

/** Server-only provider representation. Never serialize this type in an API response. */
export interface InternalProvider extends Provider {
  encryptedApiKey: EncryptedSecret;
}

export interface ProviderWithSecret extends Provider {
  apiKey: string;
}

export interface ProviderDraft extends ProviderConfig {
  baseUrl: string;
  /** Optional on existing providers; an empty value means "keep the saved key". */
  apiKey?: string;
  enabled?: boolean;
}

export interface CreateProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
}

export interface UpdateProviderInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string | null;
  reasoningLevels: string[];
  defaultReasoningLevel: string | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateModelInput {
  providerId: string;
  modelId: string;
  displayName?: string | null;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string | null;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateModelInput {
  providerId?: string;
  modelId?: string;
  displayName?: string | null;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string | null;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_ciphertext: string;
  api_key_iv: string;
  api_key_tag: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string | null;
  reasoning_levels: string[] | null;
  default_reasoning_level: string | null;
  enabled: boolean;
  metadata: Record<string, unknown> | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  api_key_tag TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  reasoning_levels TEXT[],
  default_reasoning_level TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT models_provider_model_unique UNIQUE (provider_id, model_id)
);

ALTER TABLE models ADD COLUMN IF NOT EXISTS reasoning_levels TEXT[];
ALTER TABLE models ADD COLUMN IF NOT EXISTS default_reasoning_level TEXT;

CREATE INDEX IF NOT EXISTS providers_enabled_idx ON providers (enabled);
CREATE INDEX IF NOT EXISTS models_provider_enabled_idx ON models (provider_id, enabled);
`;

let defaultDatabase: DatabaseClient | undefined;

export function getDatabase(): DatabaseClient {
  if (!defaultDatabase) defaultDatabase = neon(getRuntimeConfig().databaseUrl);
  return defaultDatabase;
}

export async function ensureSchema(db: DatabaseClient = getDatabase()): Promise<void> {
  // Neon HTTP transactions are required for multiple DDL statements to be atomic.
  const statements = SCHEMA_SQL.split(";\n").map((statement) => statement.trim()).filter(Boolean);
  await db.transaction((tx) => statements.map((statement) => tx.query(`${statement};`)));
}

async function rows<T>(db: DatabaseClient, query: string, params: unknown[] = []): Promise<T[]> {
  return db.query(query, params) as Promise<T[]>;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

export function normalizeProviderBaseUrl(value: string): string {
  const raw = normalizeRequired(value, "Provider base URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Provider base URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Provider base URL must use http or https");
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function providerFromRow(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    enabled: row.enabled,
    apiKeyConfigured: Boolean(row.api_key_ciphertext && row.api_key_iv && row.api_key_tag),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function providerWithSecretFromRow(row: ProviderRow): ProviderWithSecret {
  return {
    ...providerFromRow(row),
    apiKey: decryptApiKey({ ciphertext: row.api_key_ciphertext, iv: row.api_key_iv, authTag: row.api_key_tag }),
  };
}

function internalProviderFromRow(row: ProviderRow): InternalProvider {
  return {
    ...providerFromRow(row),
    encryptedApiKey: { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv, authTag: row.api_key_tag },
  };
}

function modelFromRow(row: ModelRow): Model {
  let metadata: Record<string, unknown> = {};
  if (typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  } else if (row.metadata && typeof row.metadata === "object") metadata = row.metadata;
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    displayName: row.display_name,
    reasoningLevels: row.reasoning_levels ?? [],
    defaultReasoningLevel: row.default_reasoning_level,
    enabled: row.enabled,
    metadata,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

const PROVIDER_COLUMNS = "id, name, base_url, api_key_ciphertext, api_key_iv, api_key_tag, enabled, created_at, updated_at";
const MODEL_COLUMNS = "id, provider_id, model_id, display_name, reasoning_levels, default_reasoning_level, enabled, metadata, created_at, updated_at";

export async function listProviders(options: { includeDisabled?: boolean; db?: DatabaseClient } = {}): Promise<Provider[]> {
  const db = options.db ?? getDatabase();
  const where = options.includeDisabled ? "" : "WHERE enabled = TRUE";
  const result = await rows<ProviderRow>(db, `SELECT ${PROVIDER_COLUMNS} FROM providers ${where} ORDER BY name ASC`);
  return result.map(providerFromRow);
}

export async function getProvider(id: string, db: DatabaseClient = getDatabase()): Promise<Provider | null> {
  const result = await rows<ProviderRow>(db, `SELECT ${PROVIDER_COLUMNS} FROM providers WHERE id = $1`, [normalizeRequired(id, "Provider id")]);
  return result[0] ? providerFromRow(result[0]) : null;
}

export async function getProviderWithSecret(id: string, db: DatabaseClient = getDatabase()): Promise<ProviderWithSecret | null> {
  const result = await rows<ProviderRow>(db, `SELECT ${PROVIDER_COLUMNS} FROM providers WHERE id = $1`, [normalizeRequired(id, "Provider id")]);
  return result[0] ? providerWithSecretFromRow(result[0]) : null;
}

export async function listInternalProviders(options: { includeDisabled?: boolean; db?: DatabaseClient } = {}): Promise<InternalProvider[]> {
  const db = options.db ?? getDatabase();
  const where = options.includeDisabled ? "" : "WHERE enabled = TRUE";
  const result = await rows<ProviderRow>(db, `SELECT ${PROVIDER_COLUMNS} FROM providers ${where} ORDER BY name ASC`);
  return result.map(internalProviderFromRow);
}

export async function createProvider(input: CreateProviderInput, db: DatabaseClient = getDatabase()): Promise<Provider> {
  const name = normalizeRequired(input.name, "Provider name");
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
  const encrypted = encryptApiKey(input.apiKey);
  const id = randomUUID();
  const result = await rows<ProviderRow>(
    db,
    `INSERT INTO providers (${PROVIDER_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING ${PROVIDER_COLUMNS}`,
    [id, name, baseUrl, encrypted.ciphertext, encrypted.iv, encrypted.authTag, input.enabled ?? true],
  );
  return providerFromRow(result[0]);
}

export async function updateProvider(id: string, input: UpdateProviderInput, db: DatabaseClient = getDatabase()): Promise<Provider | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    fields.push(`name = $${params.length + 1}`);
    params.push(normalizeRequired(input.name, "Provider name"));
  }
  if (input.baseUrl !== undefined) {
    fields.push(`base_url = $${params.length + 1}`);
    params.push(normalizeProviderBaseUrl(input.baseUrl));
  }
  if (input.apiKey !== undefined) {
    const encrypted = encryptApiKey(input.apiKey);
    fields.push(`api_key_ciphertext = $${params.length + 1}`, `api_key_iv = $${params.length + 2}`, `api_key_tag = $${params.length + 3}`);
    params.push(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
  }
  if (input.enabled !== undefined) {
    fields.push(`enabled = $${params.length + 1}`);
    params.push(input.enabled);
  }
  if (fields.length === 0) return getProvider(id, db);
  const providerId = normalizeRequired(id, "Provider id");
  params.push(providerId);
  const result = await rows<ProviderRow>(db, `UPDATE providers SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING ${PROVIDER_COLUMNS}`, params);
  return result[0] ? providerFromRow(result[0]) : null;
}

export async function deleteProvider(id: string, db: DatabaseClient = getDatabase()): Promise<boolean> {
  const result = await rows<{ id: string }>(db, "DELETE FROM providers WHERE id = $1 RETURNING id", [normalizeRequired(id, "Provider id")]);
  return result.length > 0;
}

export async function listModels(options: { providerId?: string; includeDisabled?: boolean; db?: DatabaseClient } = {}): Promise<Model[]> {
  const db = options.db ?? getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!options.includeDisabled) conditions.push("enabled = TRUE");
  if (options.providerId !== undefined) {
    conditions.push(`provider_id = $${params.length + 1}`);
    params.push(normalizeRequired(options.providerId, "Provider id"));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await rows<ModelRow>(db, `SELECT ${MODEL_COLUMNS} FROM models ${where} ORDER BY model_id ASC`, params);
  return result.map(modelFromRow);
}

function publicModelConfig(model: Model): PublicModelConfig {
  return {
    id: model.modelId,
    ...(model.displayName ? { name: model.displayName } : {}),
    ...(model.reasoningLevels.length ? { reasoningLevels: model.reasoningLevels } : {}),
    ...(model.defaultReasoningLevel ? { defaultReasoningLevel: model.defaultReasoningLevel } : {}),
  };
}

/** Return the browser-safe provider/model catalog. */
export async function listProviderConfigs(options: { includeDisabled?: boolean; db?: DatabaseClient } = {}): Promise<ProviderConfig[]> {
  const db = options.db ?? getDatabase();
  const providers = await listProviders(options);
  const result: ProviderConfig[] = [];
  for (const provider of providers) {
    const models = await listModels({ providerId: provider.id, includeDisabled: options.includeDisabled, db });
    result.push({ id: provider.id, name: provider.name, models: models.map(publicModelConfig) });
  }
  return result;
}

export async function getModel(id: string, db: DatabaseClient = getDatabase()): Promise<Model | null> {
  const result = await rows<ModelRow>(db, `SELECT ${MODEL_COLUMNS} FROM models WHERE id = $1`, [normalizeRequired(id, "Model id")]);
  return result[0] ? modelFromRow(result[0]) : null;
}

export async function createModel(input: CreateModelInput, db: DatabaseClient = getDatabase()): Promise<Model> {
  const providerId = normalizeRequired(input.providerId, "Provider id");
  const modelId = normalizeRequired(input.modelId, "Model id");
  const result = await rows<ModelRow>(db, `INSERT INTO models (${MODEL_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING ${MODEL_COLUMNS}`, [
    randomUUID(),
    providerId,
    modelId,
    input.displayName?.trim() || null,
    input.reasoningLevels ?? null,
    input.defaultReasoningLevel?.trim() || null,
    input.enabled ?? true,
    JSON.stringify(input.metadata ?? {}),
  ]);
  return modelFromRow(result[0]);
}

export async function updateModel(id: string, input: UpdateModelInput, db: DatabaseClient = getDatabase()): Promise<Model | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.providerId !== undefined) {
    fields.push(`provider_id = $${params.length + 1}`);
    params.push(normalizeRequired(input.providerId, "Provider id"));
  }
  if (input.modelId !== undefined) {
    fields.push(`model_id = $${params.length + 1}`);
    params.push(normalizeRequired(input.modelId, "Model id"));
  }
  if (input.displayName !== undefined) {
    fields.push(`display_name = $${params.length + 1}`);
    params.push(input.displayName?.trim() || null);
  }
  if (input.reasoningLevels !== undefined) {
    fields.push(`reasoning_levels = $${params.length + 1}`);
    params.push(input.reasoningLevels);
  }
  if (input.defaultReasoningLevel !== undefined) {
    fields.push(`default_reasoning_level = $${params.length + 1}`);
    params.push(input.defaultReasoningLevel?.trim() || null);
  }
  if (input.enabled !== undefined) {
    fields.push(`enabled = $${params.length + 1}`);
    params.push(input.enabled);
  }
  if (input.metadata !== undefined) {
    fields.push(`metadata = $${params.length + 1}`);
    params.push(JSON.stringify(input.metadata));
  }
  if (fields.length === 0) return getModel(id, db);
  params.push(normalizeRequired(id, "Model id"));
  const result = await rows<ModelRow>(db, `UPDATE models SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING ${MODEL_COLUMNS}`, params);
  return result[0] ? modelFromRow(result[0]) : null;
}

export async function deleteModel(id: string, db: DatabaseClient = getDatabase()): Promise<boolean> {
  const result = await rows<{ id: string }>(db, "DELETE FROM models WHERE id = $1 RETURNING id", [normalizeRequired(id, "Model id")]);
  return result.length > 0;
}

/**
 * Persist the complete admin editor payload. Existing providers retain their
 * secret when a draft omits it (or contains only whitespace); new providers
 * must supply one. Providers omitted from the draft are removed, and model
 * rows are synchronized by their provider-local model id.
 */
export async function saveConfig(
  prior: readonly InternalProvider[],
  drafts: readonly ProviderDraft[],
  db: DatabaseClient = getDatabase(),
): Promise<ProviderConfig[]> {
  const previousById = new Map(prior.map((provider) => [provider.id, provider]));
  const savedIds = new Set<string>();
  const saved: ProviderConfig[] = [];

  for (const draft of drafts) {
    const draftId = typeof draft.id === "string" ? draft.id.trim() : "";
    const existing = draftId ? previousById.get(draftId) : undefined;
    let provider: Provider;
    if (existing) {
      const update: UpdateProviderInput = {
        name: draft.name,
        baseUrl: draft.baseUrl,
        enabled: draft.enabled,
      };
      if (draft.apiKey?.trim()) update.apiKey = draft.apiKey.trim();
      provider = (await updateProvider(existing.id, update, db)) ?? existing;
    } else {
      if (!draft.apiKey?.trim()) throw new Error(`Provider ${draft.name || draftId || "new"} requires an API key`);
      provider = await createProvider({ name: draft.name, baseUrl: draft.baseUrl, apiKey: draft.apiKey.trim(), enabled: draft.enabled }, db);
    }
    savedIds.add(provider.id);

    const oldModels = await listModels({ providerId: provider.id, includeDisabled: true, db });
    const oldByModelId = new Map(oldModels.map((model) => [model.modelId, model]));
    const desiredModelIds = new Set<string>();
    const publicModels: PublicModelConfig[] = [];
    for (const draftModel of draft.models ?? []) {
      const modelId = normalizeRequired(draftModel.id, "Model id");
      if (desiredModelIds.has(modelId)) continue;
      desiredModelIds.add(modelId);
      const modelInput = {
        providerId: provider.id,
        modelId,
        displayName: draftModel.name?.trim() || null,
        reasoningLevels: draftModel.reasoningLevels?.filter((level) => typeof level === "string" && level.trim()).map((level) => level.trim()),
        defaultReasoningLevel: draftModel.defaultReasoningLevel?.trim() || null,
      };
      if (oldByModelId.has(modelId)) await updateModel(oldByModelId.get(modelId)!.id, modelInput, db);
      else await createModel(modelInput, db);
      publicModels.push({
        id: modelId,
        ...(modelInput.displayName ? { name: modelInput.displayName } : {}),
        ...(modelInput.reasoningLevels?.length ? { reasoningLevels: modelInput.reasoningLevels } : {}),
        ...(modelInput.defaultReasoningLevel ? { defaultReasoningLevel: modelInput.defaultReasoningLevel } : {}),
      });
    }
    for (const oldModel of oldModels) if (!desiredModelIds.has(oldModel.modelId)) await deleteModel(oldModel.id, db);
    saved.push({ id: provider.id, name: provider.name, models: publicModels });
  }

  for (const previous of prior) if (!savedIds.has(previous.id)) await deleteProvider(previous.id, db);
  return saved;
}

/** Exported for route code that needs to inspect the encrypted columns without duplicating their shape. */
export type ProviderSecretColumns = Pick<ProviderRow, "api_key_ciphertext" | "api_key_iv" | "api_key_tag">;

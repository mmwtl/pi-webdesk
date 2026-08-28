import { createModel, deleteModel, getProvider, listModels, updateModel } from "../_lib/database.js";
import { requireAdmin } from "../_lib/auth.js";
import { errorResponse, HttpError, isRecord, json, methodNotAllowed, optionalBoolean, optionalString, parseJsonObject, parseQueryId, requiredString } from "../_lib/http.js";
import { prepareDatabase } from "../_lib/ready.js";

function metadata(body: Record<string, unknown>): Record<string, unknown> | undefined {
  if (body.metadata === undefined) return undefined;
  if (!isRecord(body.metadata) || JSON.stringify(body.metadata).length > 100_000) throw new HttpError(400, "metadata must be a JSON object");
  return body.metadata;
}

function reasoningLevels(body: Record<string, unknown>): string[] | undefined {
  if (body.reasoningLevels === undefined) return undefined;
  if (!Array.isArray(body.reasoningLevels) || body.reasoningLevels.length > 16 || body.reasoningLevels.some((level) => typeof level !== "string" || !level.trim() || level.length > 32)) {
    throw new HttpError(400, "reasoningLevels must be a short list of strings");
  }
  return [...new Set(body.reasoningLevels.map((level) => level.trim()))];
}

function displayName(body: Record<string, unknown>): string | undefined {
  return optionalString(body, "displayName", 500) ?? optionalString(body, "name", 500);
}

async function verifyProvider(providerId: string): Promise<void> {
  if (!await getProvider(providerId, undefined)) throw new HttpError(404, "Provider not found");
}

async function handler(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await prepareDatabase();
    if (request.method === "GET") {
      const providerId = new URL(request.url).searchParams.get("providerId")?.trim();
      return json({ models: await listModels({ includeDisabled: true, ...(providerId ? { providerId } : {}) }) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST") {
      const body = await parseJsonObject(request);
      const providerId = requiredString(body, "providerId", 200);
      await verifyProvider(providerId);
      const model = await createModel({ providerId, modelId: requiredString(body, "modelId", 500), displayName: displayName(body), reasoningLevels: reasoningLevels(body), defaultReasoningLevel: optionalString(body, "defaultReasoningLevel", 32), enabled: optionalBoolean(body, "enabled"), metadata: metadata(body) });
      return json({ model }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "PATCH" || request.method === "PUT") {
      const body = await parseJsonObject(request);
      const providerId = optionalString(body, "providerId", 200);
      if (providerId) await verifyProvider(providerId);
      const model = await updateModel(parseQueryId(request, "Model id"), { providerId, modelId: optionalString(body, "modelId", 500), displayName: displayName(body), reasoningLevels: reasoningLevels(body), defaultReasoningLevel: optionalString(body, "defaultReasoningLevel", 32), enabled: optionalBoolean(body, "enabled"), metadata: metadata(body) });
      if (!model) throw new HttpError(404, "Model not found");
      return json({ model }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteModel(parseQueryId(request, "Model id"));
      if (!deleted) throw new HttpError(404, "Model not found");
      return json({ ok: true });
    }
    return methodNotAllowed(["GET", "POST", "PATCH", "PUT", "DELETE"]);
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET(request: Request): Promise<Response> { return handler(request); }
export function POST(request: Request): Promise<Response> { return handler(request); }
export function PATCH(request: Request): Promise<Response> { return handler(request); }
export function PUT(request: Request): Promise<Response> { return handler(request); }
export function DELETE(request: Request): Promise<Response> { return handler(request); }

import { getProviderWithSecret } from "../_lib/database.js";
import { requireAdmin } from "../_lib/auth.js";
import { errorResponse, HttpError, isRecord, json, methodNotAllowed, parseJsonObject, requiredString } from "../_lib/http.js";
import { prepareDatabase } from "../_lib/ready.js";

function modelsUrl(baseUrl: string): string {
  return new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

export default async function handler(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    await prepareDatabase();
    const body = await parseJsonObject(request, 16_384);
    const providerId = requiredString(body, "providerId", 200);
    const provider = await getProviderWithSecret(providerId);
    if (!provider) throw new HttpError(404, "Provider not found");
    if (!provider.apiKey.trim()) throw new HttpError(503, "Provider API key is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(modelsUrl(provider.baseUrl), { headers: { Accept: "application/json", Authorization: `Bearer ${provider.apiKey}` }, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new HttpError(502, `Provider model discovery failed (${response.status})`);
    const payload: unknown = await response.json();
    const raw = isRecord(payload) && Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const models = raw.slice(0, 2_000).flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim() || item.id.length > 500) return [];
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 500) : undefined;
      const reasoning = isRecord(item.reasoning) ? item.reasoning : undefined;
      const supportedEfforts = Array.isArray(reasoning?.supported_efforts)
        ? reasoning.supported_efforts.filter((level): level is string => typeof level === "string" && level.length <= 32).map((level) => level.toLowerCase())
        : [];
      const mandatory = reasoning?.mandatory === true;
      const reasoningLevels = [...new Set([...(mandatory ? [] : ["off"]), ...supportedEfforts])];
      const defaultReasoningLevel = typeof reasoning?.default_effort === "string" && reasoningLevels.includes(reasoning.default_effort.toLowerCase())
        ? reasoning.default_effort.toLowerCase()
        : undefined;
      return [{ id: item.id.trim(), ...(name ? { name } : {}), ...(reasoningLevels.length ? { reasoningLevels } : {}), ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}) }];
    });
    return json({ providerId, models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return json({ error: "Provider model discovery timed out" }, { status: 504 });
    return errorResponse(error);
  }
}

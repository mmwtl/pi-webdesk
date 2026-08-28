import { getProviderWithSecret, listModels } from "../_lib/database.js";
import { errorResponse, HttpError, json, methodNotAllowed, parseJsonObject } from "../_lib/http.js";
import { prepareDatabase } from "../_lib/ready.js";

function upstreamUrl(baseUrl: string): string {
  return new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    await prepareDatabase();
    const providerId = request.headers.get("x-pi-webdesk-provider")?.trim() ?? "";
    if (!providerId || providerId.length > 200) throw new HttpError(400, "X-Pi-Webdesk-Provider header is required");
    const provider = await getProviderWithSecret(providerId);
    if (!provider || !provider.enabled) throw new HttpError(404, "Provider not found");
    if (!provider.apiKey.trim()) throw new HttpError(503, "Provider API key is not configured");
    const body = await parseJsonObject(request, 4 * 1024 * 1024);
    if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 500) throw new HttpError(400, "A model is required");
    const enabledModels = await listModels({ providerId });
    if (!enabledModels.some((model) => model.modelId === body.model)) throw new HttpError(400, "The selected model is not enabled for this provider");
    body.stream = true;
    const response = await fetch(upstreamUrl(provider.baseUrl), {
      method: "POST",
      headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      redirect: "manual",
      // A cancelled browser request also cancels the provider request.
      signal: request.signal,
    });
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    if (response.ok && response.body) {
      headers.set("Cache-Control", "no-cache, no-transform");
      return new Response(response.body, { status: response.status, headers });
    }
    const payload = await response.arrayBuffer();
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(payload, { status: response.status, headers });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return json({ error: "The request was cancelled or timed out" }, { status: 504 });
    return errorResponse(error);
  }
}

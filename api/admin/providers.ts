import { createProvider, deleteProvider, listProviders, updateProvider } from "../_lib/database.js";
import { requireAdmin } from "../_lib/auth.js";
import { errorResponse, HttpError, json, methodNotAllowed, optionalBoolean, optionalString, parseJsonObject, parseQueryId, requiredString } from "../_lib/http.js";
import { prepareDatabase } from "../_lib/ready.js";

export default async function handler(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await prepareDatabase();
    if (request.method === "GET") return json({ providers: await listProviders({ includeDisabled: true }) }, { headers: { "Cache-Control": "no-store" } });
    if (request.method === "POST") {
      const body = await parseJsonObject(request);
      const provider = await createProvider({
        name: requiredString(body, "name", 200),
        baseUrl: requiredString(body, "baseUrl", 2_000),
        apiKey: requiredString(body, "apiKey", 10_000),
        enabled: optionalBoolean(body, "enabled"),
      });
      return json({ provider }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "PATCH" || request.method === "PUT") {
      const body = await parseJsonObject(request);
      const apiKey = optionalString(body, "apiKey", 10_000);
      const provider = await updateProvider(parseQueryId(request, "Provider id"), {
        name: optionalString(body, "name", 200),
        baseUrl: optionalString(body, "baseUrl", 2_000),
        // A blank key means "keep the existing key"; the database never exposes it for editing.
        apiKey: apiKey?.trim() ? apiKey : undefined,
        enabled: optionalBoolean(body, "enabled"),
      });
      if (!provider) throw new HttpError(404, "Provider not found");
      return json({ provider }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteProvider(parseQueryId(request, "Provider id"));
      if (!deleted) throw new HttpError(404, "Provider not found");
      return json({ ok: true });
    }
    return methodNotAllowed(["GET", "POST", "PATCH", "PUT", "DELETE"]);
  } catch (error) {
    return errorResponse(error);
  }
}

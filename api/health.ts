import { listProviders } from "./_lib/database";
import { errorResponse, json, methodNotAllowed } from "./_lib/http";
import { prepareDatabase } from "./_lib/ready";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    await prepareDatabase();
    const providers = await listProviders();
    return json({ ok: true, providers: providers.length });
  } catch (error) {
    return errorResponse(error);
  }
}

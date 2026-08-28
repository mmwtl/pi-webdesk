import { listProviderConfigs } from "./_lib/database";
import { errorResponse, json, methodNotAllowed } from "./_lib/http";
import { prepareDatabase } from "./_lib/ready";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    await prepareDatabase();
    return json({ providers: await listProviderConfigs() }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    return errorResponse(error);
  }
}

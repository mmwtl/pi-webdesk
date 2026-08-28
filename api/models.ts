import { listModels } from "./_lib/database.js";
import { errorResponse, json, methodNotAllowed } from "./_lib/http.js";
import { prepareDatabase } from "./_lib/ready.js";

/**
 * Backward-compatible, browser-safe model list. The composer uses /api/config
 * because that keeps models associated with their providers.
 */
export async function GET(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    await prepareDatabase();
    const models = await listModels();
    return json({
      data: models.map((model) => ({
        id: model.modelId,
        ...(model.displayName ? { name: model.displayName } : {}),
        ...(model.reasoningLevels.length ? {
          reasoning: {
            supported_efforts: model.reasoningLevels.filter((level) => level !== "off"),
            default_effort: model.defaultReasoningLevel,
            mandatory: !model.reasoningLevels.includes("off"),
          },
        } : {}),
      })),
    }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    return errorResponse(error);
  }
}

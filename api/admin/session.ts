import { login, logout, sessionStatus } from "../_lib/auth.js";
import { errorResponse, methodNotAllowed, parseJsonObject, requiredString } from "../_lib/http.js";

async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === "GET") return sessionStatus(request);
    if (request.method === "DELETE") return logout();
    if (request.method !== "POST") return methodNotAllowed(["GET", "POST", "DELETE"]);
    const body = await parseJsonObject(request, 16_384);
    return login(requiredString(body, "password", 1_000));
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET(request: Request): Promise<Response> { return handler(request); }
export function POST(request: Request): Promise<Response> { return handler(request); }
export function DELETE(request: Request): Promise<Response> { return handler(request); }

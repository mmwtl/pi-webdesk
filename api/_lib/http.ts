export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json({ error: "Method not allowed" }, { status: 405, headers: { Allow: allowed.join(", ") } });
}

export function parseQueryId(request: Request, label: string): string {
  const value = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!value || value.length > 200) throw new HttpError(400, `${label} is required`);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse only small JSON objects. Admin routes never need arbitrarily large payloads. */
export async function parseJsonObject(request: Request, maxBytes = 1_048_576): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length && Number.isFinite(Number(length)) && Number(length) > maxBytes) throw new HttpError(413, "Request body is too large");
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  if (!isRecord(value)) throw new HttpError(400, "Request body must be a JSON object");
  // Content-Length is optional for chunked requests; enforce the limit after parsing too.
  if (JSON.stringify(value).length > maxBytes) throw new HttpError(413, "Request body is too large");
  return value;
}

export function requiredString(body: Record<string, unknown>, key: string, maxLength = 500): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new HttpError(400, `${key} must be a non-empty string`);
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, key: string, maxLength = 500): string | undefined {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== "string" || body[key].length > maxLength) throw new HttpError(400, `${key} must be a string`);
  return body[key].trim();
}

export function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== "boolean") throw new HttpError(400, `${key} must be a boolean`);
  return body[key];
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "";
  if (/not configured|must use postgres|not a valid PostgreSQL|encryption key/i.test(message)) return json({ error: "Server configuration is incomplete" }, { status: 503 });
  if (/must not be empty|must be a non-empty string|must be a string|is not valid|must use http|Provider API key/i.test(message)) return json({ error: message }, { status: 400 });
  console.error("API route error", error);
  return json({ error: "Internal server error" }, { status: 500 });
}

export function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

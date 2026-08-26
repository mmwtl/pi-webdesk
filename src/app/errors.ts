export const STANDARD_ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "The request was invalid. Check the selected model and request parameters.",
  401: "The API key is missing or invalid.",
  403: "The API key does not have permission to use this endpoint or model.",
  404: "The API endpoint or selected model was not found.",
  408: "The provider timed out while processing the request. Try again.",
  409: "The request conflicts with the provider's current state. Try again.",
  413: "The request is too large for the provider's context limit.",
  422: "The provider could not process the request format.",
  429: "The provider is rate-limiting requests. Try again later or use another key/provider.",
  500: "The provider encountered an internal server error.",
  502: "The provider gateway returned an invalid response.",
  503: "The provider is temporarily unavailable. Try again later.",
  504: "The provider gateway timed out. Try again later.",
  529: "The provider is overloaded. Try again later.",
};

function errorCodeFromText(value: string): number | undefined {
  const prefix = value.match(/^\s*(?:HTTP\s*)?([1-5]\d{2})\b/i)?.[1];
  if (prefix) return Number(prefix);

  const field = value.match(/["'](?:status|status_code|statusCode|code)["']\s*:\s*["']?([1-5]\d{2})\b/i)?.[1];
  if (field) return Number(field);

  const labeled = value.match(/\b(?:HTTP|status|status_code|statusCode|code|error)\s*[:=]?\s*([1-5]\d{2})\b/i)?.[1];
  return labeled ? Number(labeled) : undefined;
}

export function summarizeError(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  const code = errorCodeFromText(text);
  if (!code) return "The request failed. Please try again.";
  return `${code} — ${STANDARD_ERROR_DESCRIPTIONS[code] ?? "The provider rejected the request."}`;
}

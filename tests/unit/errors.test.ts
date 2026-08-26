import { describe, expect, test } from "vitest";
import { summarizeError } from "../../src/app/errors.ts";

describe("error summaries", () => {
  test("maps a provider rate-limit response to a short chat description", () => {
    expect(summarizeError('429: {"message":"temporarily rate-limited upstream"}')).toBe("429 — The provider is rate-limiting requests. Try again later or use another key/provider.");
  });

  test("reads standard codes from JSON payloads", () => {
    expect(summarizeError('{"error":{"status":503,"message":"busy"}}')).toBe("503 — The provider is temporarily unavailable. Try again later.");
  });

  test("reads codes from labeled provider errors", () => {
    expect(summarizeError("Error: 401 Unauthorized")).toBe("401 — The API key is missing or invalid.");
  });

  test("uses a safe fallback for unknown errors", () => {
    expect(summarizeError("Network connection failed")).toBe("The request failed. Please try again.");
  });
});

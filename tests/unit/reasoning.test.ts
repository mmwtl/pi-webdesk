import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchModelCatalog, fetchReasoningCapabilities } from "../../src/agent/browserFetch.ts";
import { createModel, createStreamFunction } from "../../src/agent/createModel.ts";
import { defaultSettings } from "../../src/app/state.ts";

afterEach(() => vi.unstubAllGlobals());

describe("reasoning levels", () => {
  test("loads an OpenAI-compatible model catalog with optional reasoning metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "stealth/ox-alpha", name: "Ox Alpha", reasoning: { mandatory: true, default_effort: "high", supported_efforts: ["low", "high", "max"] } },
        { id: "gpt-4.1-mini" },
        { name: "invalid without an id" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(fetchModelCatalog("https://provider.example/v1", "key")).resolves.toEqual([
      { id: "stealth/ox-alpha", name: "Ox Alpha", reasoning: { levels: ["low", "high", "max"], defaultLevel: "high", mandatory: true } },
      { id: "gpt-4.1-mini" },
    ]);
  });

  test("reads OpenRouter-style supported efforts and keeps their Pi order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: "stealth/ox-alpha",
        reasoning: { mandatory: true, default_effort: "max", supported_efforts: ["max", "high", "low"] },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(fetchReasoningCapabilities("https://openrouter.ai/api/v1", "key", "stealth/ox-alpha")).resolves.toEqual({
      levels: ["low", "high", "max"],
      defaultLevel: "max",
      mandatory: true,
    });
  });

  test("falls back when the selected model has no reasoning metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }), { status: 200 })));

    await expect(fetchReasoningCapabilities("https://api.example.com/v1", "key", "gpt-4.1-mini")).resolves.toBeUndefined();
  });

  test("creates a model with an explicit Pi level map", () => {
    const model = createModel({ ...defaultSettings, modelId: "stealth/ox-alpha", reasoningLevel: "high" });
    expect(model.reasoning).toBe(true);
    expect(model.thinkingLevelMap).toEqual({ off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" });

    expect(createModel({ ...defaultSettings, reasoningLevel: "off" }).reasoning).toBe(false);
  });

  test("puts the selected Pi level on the OpenAI-compatible wire payload", async () => {
    const responseBody = [
      `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "stealth/ox-alpha", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "stealth/ox-alpha", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(responseBody, { status: 200, headers: { "content-type": "text/event-stream" } })));

    let payload: Record<string, unknown> | undefined;
    const settings = { ...defaultSettings, baseUrl: "https://openrouter.ai/api/v1", apiKey: "key", modelId: "stealth/ox-alpha", reasoningLevel: "high" as const };
    const stream = createStreamFunction(settings)(createModel(settings), { messages: [{ role: "user", content: "hello", timestamp: 0 }] }, {
      reasoning: "high",
      onPayload: (value) => { payload = value as Record<string, unknown>; },
    });
    await stream.result();

    expect(payload?.reasoning).toEqual({ effort: "high" });

    let offPayload: Record<string, unknown> | undefined;
    const offSettings = { ...settings, reasoningLevel: "off" as const };
    const offStream = createStreamFunction(offSettings)(createModel(offSettings), { messages: [{ role: "user", content: "hello", timestamp: 0 }] }, {
      reasoning: undefined,
      onPayload: (value) => { offPayload = value as Record<string, unknown>; },
    });
    await offStream.result();

    expect(offPayload?.reasoning).toBeUndefined();
  });
});

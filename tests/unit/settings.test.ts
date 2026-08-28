import { describe, expect, test, vi } from "vitest";
import { defaultSettings } from "../../src/app/state.ts";

const storage = vi.hoisted(() => ({ writes: [] as string[], stored: undefined as Record<string, unknown> | undefined }));

vi.mock("../../src/persistence/database.ts", () => ({
  idbGet: vi.fn(async () => storage.stored),
  idbPut: vi.fn(async (_store: string, value: { modelId: string }) => {
    if (value.modelId.includes("\\")) await new Promise((resolve) => setTimeout(resolve, 15));
    storage.writes.push(value.modelId);
  }),
}));

import { loadSettings, saveSettings } from "../../src/persistence/settings.ts";

describe("settings persistence", () => {
  test("migrates the old reasoning checkbox to medium", async () => {
    storage.stored = { reasoningEnabled: true, rememberKey: true, apiKey: "secret" };

    await expect(loadSettings()).resolves.toEqual({
      ...defaultSettings,
      reasoningLevel: "medium",
      providers: [defaultSettings.providers[0]],
    });

    storage.stored = undefined;
  });

  test("loads the saved user prompt", async () => {
    storage.stored = { userPrompt: "Prefer concise answers." };

    await expect(loadSettings()).resolves.toMatchObject({ userPrompt: "Prefer concise answers." });

    storage.stored = undefined;
  });

  test("keeps rapid saves in invocation order", async () => {
    storage.writes.length = 0;
    const withBackslash = { ...defaultSettings, modelId: "provider\\model" };
    const withSlash = { ...defaultSettings, modelId: "provider/model" };

    await Promise.all([saveSettings(withBackslash), saveSettings(withSlash)]);

    expect(storage.writes).toEqual(["provider\\model", "provider/model"]);
  });
});

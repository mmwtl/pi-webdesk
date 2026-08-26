import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionRecord } from "../../src/app/state.ts";

const database = vi.hoisted(() => ({
  record: undefined as SessionRecord | undefined,
  writes: [] as SessionRecord[],
}));

vi.mock("../../src/persistence/database.ts", () => ({
  idbGet: vi.fn(async () => database.record),
  idbPut: vi.fn(async (_store: string, value: SessionRecord) => {
    database.writes.push(value);
  }),
  idbGetAll: vi.fn(async () => []),
  idbDelete: vi.fn(async () => undefined),
}));

import { renameSession } from "../../src/persistence/sessions.ts";

describe("session rename", () => {
  beforeEach(() => {
    database.writes.length = 0;
    database.record = {
      id: "session-1",
      workspaceId: "workspace-1",
      name: "New session",
      titleMode: "auto",
      createdAt: "2026-08-26T08:00:00.000Z",
      updatedAt: "2026-08-26T09:00:00.000Z",
      baseUrl: "http://127.0.0.1:1234",
      modelId: "test-model",
      systemPromptHash: "",
      messages: [],
    };
  });

  test("marks a manual title without changing session recency", async () => {
    const renamed = await renameSession("session-1", "Project notes", "manual");

    expect(renamed).toMatchObject({
      name: "Project notes",
      titleMode: "manual",
      updatedAt: "2026-08-26T09:00:00.000Z",
    });
    expect(database.writes).toHaveLength(1);
    expect(database.writes[0]).toMatchObject({
      name: "Project notes",
      titleMode: "manual",
      updatedAt: "2026-08-26T09:00:00.000Z",
    });
  });
});

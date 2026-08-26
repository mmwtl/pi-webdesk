import { describe, expect, test } from "vitest";
import { createSystemPrompt } from "../../src/agent/systemPrompt.ts";

const workspace = {
  id: "workspace-1",
  name: "Demo workspace",
  permission: "granted" as PermissionState,
  canWrite: true,
};

describe("system prompt", () => {
  test("includes configured user instructions without removing the browser boundary", () => {
    const prompt = createSystemPrompt(workspace, "write", "Prefer concise answers.\nExplain risky changes first.");

    expect(prompt).toContain("User-provided instructions configured in Settings:\nPrefer concise answers.\nExplain risky changes first.");
    expect(prompt).toContain("There is no shell, Git, terminal, compiler, process runner, or file watcher.");
  });

  test("does not add an empty custom prompt section", () => {
    expect(createSystemPrompt(workspace, "read", "  ")).not.toContain("User-provided instructions configured in Settings:");
  });
});

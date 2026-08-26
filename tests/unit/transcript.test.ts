import { describe, expect, test } from "vitest";
import { groupTranscriptMessages } from "../../src/app/transcript.ts";

describe("groupTranscriptMessages", () => {
  test("combines assistant messages and tool results until the next user message", () => {
    const groups = groupTranscriptMessages([
      { role: "user", content: "Inspect the project" },
      { role: "assistant", content: "I will inspect it" },
      { role: "toolResult", content: "files" },
      { role: "assistant", content: "Inspection complete" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({ role: "assistant" });
    if (groups[1].role === "assistant") expect(groups[1].messages).toHaveLength(3);
  });

  test("starts a new assistant response after each user message", () => {
    const groups = groupTranscriptMessages([
      { role: "assistant", content: "First" },
      { role: "user", content: "Next question" },
      { role: "assistant", content: "Second" },
    ]);

    expect(groups.map((group) => group.role)).toEqual(["assistant", "user", "assistant"]);
  });
});
